import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookingStatus } from '@prisma/client';
import { type TenantDb } from '@/lib/tenant/db';
import { SlotUnavailableError } from '@/lib/tenant/errors';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from './helpers/test-database';
import { createTenantDb } from '@/lib/tenant/db';

const MINUTE = 60_000;

function bookSlot(
  db: TenantDb,
  fixture: TenantFixture,
  startsAt: Date,
  status: BookingStatus = 'HOLD',
): Promise<string> {
  return db.forTenant(fixture.tenantId, async (tx) => {
    const booking = await tx.booking.create({
      data: {
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * MINUTE),
        // Fim + buffer de 10 min do serviço do fixture.
        blockedUntil: new Date(startsAt.getTime() + 40 * MINUTE),
        status,
        holdExpiresAt: status === 'HOLD' ? new Date(startsAt.getTime() + 10 * MINUTE) : null,
        priceCents: 5000,
        source: 'PORTAL',
      },
    });
    return booking.id;
  });
}

describe('anti double-booking (booking_no_overlap)', () => {
  let admin: TenantDb;
  let db: TenantDb;
  let fixture: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    db = createTenantDb(rlsDatabaseUrl());
    fixture = await createTenantFixture(admin, 'overlap');
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (db) await db.disconnect();
    if (admin) await admin.disconnect();
  });

  it('duas transações simultâneas no mesmo slot: exatamente uma falha', async () => {
    const slot = new Date('2026-11-10T13:00:00.000Z');

    const results = await Promise.allSettled([bookSlot(db, fixture, slot), bookSlot(db, fixture, slot)]);

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(SlotUnavailableError);

    const count = await admin.asPlatformAdmin((tx) =>
      tx.booking.count({ where: { staffId: fixture.staffId, startsAt: slot } }),
    );
    expect(count).toBe(1);
  });

  it('o buffer do serviço é garantido pelo banco (blockedUntil)', async () => {
    const first = new Date('2026-11-11T13:00:00.000Z');
    await bookSlot(db, fixture, first);

    // 13:30-14:00 + buffer colide com [13:00, 13:40): o fim do primeiro mais o
    // buffer ainda está em curso.
    await expect(bookSlot(db, fixture, new Date('2026-11-11T13:30:00.000Z'))).rejects.toBeInstanceOf(
      SlotUnavailableError,
    );

    // 13:40 em diante está livre: o intervalo é half-open [startsAt, blockedUntil).
    await expect(
      bookSlot(db, fixture, new Date('2026-11-11T13:40:00.000Z')),
    ).resolves.toEqual(expect.any(String));
  });

  it('agendamento CANCELLED não ocupa o slot (constraint parcial)', async () => {
    const slot = new Date('2026-11-12T13:00:00.000Z');

    await bookSlot(db, fixture, slot, 'CANCELLED');
    await expect(bookSlot(db, fixture, slot)).resolves.toEqual(expect.any(String));
  });
});
