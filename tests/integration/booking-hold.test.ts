// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { getAvailability } from '@/lib/booking/availability';
import { HOLD_DURATION_MINUTES, HoldError, createHold, type CreatedHold } from '@/lib/booking/hold';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import { SlotUnavailableError } from '@/lib/tenant/errors';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Hold de 10 minutos (tarefa F3.2): criação, limpeza dos vencidos na mesma
 * transação, concorrência e isolamento entre tenants.
 */

const MINUTE = 60_000;

interface HoldSpec {
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  startsAt: Date;
  holdSessionId: string;
  now?: Date;
}

describe('hold de 10 minutos', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let second: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'hold');
    second = await createTenantFixture(admin, 'hold-b');
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin && second) await deleteTenant(admin, second.tenantId);
    if (admin) await admin.disconnect();
  });

  function spec(overrides: Partial<HoldSpec> & { startsAt: Date }): HoldSpec {
    return {
      tenantId: fixture.tenantId,
      customerId: fixture.customerMemberId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      holdSessionId: 'session-1',
      ...overrides,
    };
  }

  async function readBooking(id: string): Promise<{ status: string } | null> {
    return forTenant(fixture.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id }, select: { status: true } }),
    );
  }

  it('cria HOLD com duração, buffer, preço e expiração de 10 minutos', async () => {
    const now = new Date('2026-12-01T12:00:00.000Z');
    const startsAt = new Date('2026-12-01T13:00:00.000Z');

    const hold = await createHold(spec({ startsAt, now }));

    expect(hold.status).toBe('HOLD');
    expect(hold.endsAt.getTime() - startsAt.getTime()).toBe(30 * MINUTE);
    expect(hold.blockedUntil.getTime() - startsAt.getTime()).toBe(40 * MINUTE);
    expect(hold.holdExpiresAt.toISOString()).toBe(
      new Date(now.getTime() + HOLD_DURATION_MINUTES * MINUTE).toISOString(),
    );
    expect(hold.holdExpiresAt.toISOString()).toBe('2026-12-01T12:10:00.000Z');
    expect(hold.holdSessionId).toBe('session-1');
    expect(hold.priceCents).toBe(5000);
  });

  it('exige holdSessionId: um hold sem dono é recusado', async () => {
    await expect(
      createHold(spec({ startsAt: new Date('2026-12-01T14:00:00.000Z'), holdSessionId: '   ' })),
    ).rejects.toBeInstanceOf(HoldError);
  });

  it('20 tentativas simultâneas no mesmo slot: 1 hold e 19 erros de domínio, nunca 500', async () => {
    const startsAt = new Date('2026-12-02T13:00:00.000Z');

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        createHold(spec({ startsAt, holdSessionId: `concurrent-${index}` })),
      ),
    );

    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<CreatedHold> => result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(19);
    for (const result of rejected) {
      // Qualquer erro que não seja SlotUnavailableError seria um 500 em potencial.
      expect(result.reason).toBeInstanceOf(SlotUnavailableError);
    }

    const count = await admin.asPlatformAdmin((tx) =>
      tx.booking.count({ where: { tenantId: fixture.tenantId, staffId: fixture.staffId, startsAt } }),
    );
    expect(count).toBe(1);
  });

  it('hold vencido volta à grade sem o cron, e o próximo hold limpa o vencido na mesma transação', async () => {
    const startsAt = new Date('2026-12-03T15:00:00.000Z');
    const created = await createHold(
      spec({ startsAt, holdSessionId: 'expira', now: new Date('2026-12-03T12:00:00.000Z') }),
    );

    const tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: fixture.tenantId },
        select: { timezone: true },
      }),
    );
    const timezone = tenant.timezone;
    const date = '2026-12-03';
    const dayStart = fromZonedTime(`${date}T00:00:00`, timezone);
    const weekday = toZonedTime(dayStart, timezone).getDay();
    const workingHours = [{ weekday, startTime: '09:00', endTime: '18:00' }];

    const loaded = await forTenant(fixture.tenantId, (tx) =>
      tx.booking.findMany({
        where: { tenantId: fixture.tenantId, staffId: fixture.staffId },
        select: {
          startsAt: true,
          blockedUntil: true,
          status: true,
          holdExpiresAt: true,
        },
      }),
    );

    const beforeExpiry = new Date('2026-12-03T12:05:00.000Z');
    const afterExpiry = new Date('2026-12-03T12:11:00.000Z');

    const slotsBefore = getAvailability({
      date,
      timezone,
      workingHours,
      service: { durationMin: 30, bufferMin: 10 },
      bookings: loaded,
      now: beforeExpiry,
    });
    const slotsAfter = getAvailability({
      date,
      timezone,
      workingHours,
      service: { durationMin: 30, bufferMin: 10 },
      bookings: loaded,
      now: afterExpiry,
    });

    expect(slotsBefore).not.toContain(startsAt.toISOString());
    expect(slotsAfter).toContain(startsAt.toISOString());

    // O cron não rodou: a linha vencida continua no banco, só não ocupa.
    expect(await readBooking(created.id)).not.toBeNull();

    const replacement = await createHold(
      spec({ startsAt, holdSessionId: 'expira-2', now: afterExpiry }),
    );
    expect(replacement.id).not.toBe(created.id);
    // A limpeza dos vencidos aconteceu DENTRO da transação que inseriu o novo.
    expect(await readBooking(created.id)).toBeNull();
    expect(await readBooking(replacement.id)).not.toBeNull();
  });

  it('o hold de um tenant é invisível para outro e não bloqueia a agenda dele', async () => {
    const startsAt = new Date('2026-12-04T13:00:00.000Z');

    const holdA = await createHold(spec({ startsAt, holdSessionId: 'tenant-a' }));

    const seenByB = await forTenant(second.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: holdA.id }, select: { id: true } }),
    );
    expect(seenByB).toBeNull();

    // Mesmo instante, outro tenant e outro profissional: a constraint é por
    // (staff_id, intervalo), então o hold do tenant B convive sem problema.
    const holdB = await createHold({
      tenantId: second.tenantId,
      customerId: second.customerMemberId,
      staffId: second.staffId,
      serviceId: second.serviceId,
      startsAt,
      holdSessionId: 'tenant-b',
    });
    expect(holdB.id).not.toBe(holdA.id);
  });
});
