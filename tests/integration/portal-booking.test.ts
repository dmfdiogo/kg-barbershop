// @vitest-environment node
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { TenantContext } from '@/lib/tenant/context';
import { resolveTenantById, toTenantContext } from '@/lib/tenant/context';
import { getTenantDb, type TenantDb } from '@/lib/tenant/db';
import { confirmCustomerHold, createBookingHold, PortalBookingError } from '@/app/[slug]/(portal)/agendar/_lib/booking-flow';
import { buildSlotOptions, dayOfInstant, loadDayState } from '@/app/[slug]/(portal)/agendar/_lib/availability';
import {
  createAdminDb,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
} from './helpers/test-database';

/**
 * Fluxo de agendamento (F3.3) contra Postgres real: hold amarrado ao
 * dispositivo, confirmação idempotente (clique duplo) e isolamento entre
 * tenants. A garantia de anti-overlap é a exclusion constraint — aqui o que se
 * prova é a orquestração em volta dela.
 */

const TZ = 'America/Sao_Paulo';
const TARGET_DATE = '2026-12-15';
const MINUTE = 60_000;

interface TenantFixture {
  tenantId: string;
  slug: string;
  staffId: string;
  serviceId: string;
  customerId: string;
}

function phone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

function wallClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

async function createFixture(admin: TenantDb, prefix: string): Promise<TenantFixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
  const slug = `${prefix}-${suffix}`;
  const weekday = toZonedTime(fromZonedTime(`${TARGET_DATE}T00:00:00`, TZ), TZ).getDay();

  return admin.asPlatformAdmin(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug,
        name: `Tenant ${suffix}`,
        document: '12345678901',
        timezone: TZ,
        status: 'ACTIVE',
      },
    });

    const staffUser = await tx.user.create({ data: { phone: phone(), name: 'Profissional' } });
    const staffMember = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' },
    });
    const profile = await tx.staffProfile.create({
      data: { tenantId: tenant.id, tenantMemberId: staffMember.id },
    });
    await tx.workingHours.create({
      data: {
        tenantId: tenant.id,
        staffId: profile.id,
        weekday,
        startTime: wallClock('09:00'),
        endTime: wallClock('18:00'),
      },
    });

    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        name: 'Corte',
        durationMin: 30,
        bufferMin: 10,
        priceCents: 5000,
        paymentMode: 'ON_SITE',
      },
    });
    await tx.staffService.create({
      data: { tenantId: tenant.id, staffId: profile.id, serviceId: service.id },
    });

    const customerUser = await tx.user.create({ data: { phone: phone(), name: 'Cliente' } });
    const customer = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: customerUser.id, role: 'CUSTOMER' },
    });

    return {
      tenantId: tenant.id,
      slug,
      staffId: profile.id,
      serviceId: service.id,
      customerId: customer.id,
    };
  });
}

async function contextFor(tenantId: string): Promise<TenantContext> {
  const lookup = await resolveTenantById(tenantId);
  if (!lookup.ok) throw new Error('Fixture tenant não resolveu.');
  return toTenantContext(lookup);
}

describe('fluxo de agendamento do portal', () => {
  let admin: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ctxA: TenantContext;
  let ctxB: TenantContext;

  const startsAt = fromZonedTime(`${TARGET_DATE}T09:00:00`, TZ);
  const now = new Date(fromZonedTime(`${TARGET_DATE}T08:00:00`, TZ).getTime());

  function slotAt(hhmm: string): Date {
    return fromZonedTime(`${TARGET_DATE}T${hhmm}:00`, TZ);
  }

  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    await ensureTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = rlsDatabaseUrl();
    admin = createAdminDb();
    tenantA = await createFixture(admin, 'flow-a');
    tenantB = await createFixture(admin, 'flow-b');
    ctxA = await contextFor(tenantA.tenantId);
    ctxB = await contextFor(tenantB.tenantId);
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.tenantId);
      if (tenantB) await deleteTenant(admin, tenantB.tenantId);
      await admin.disconnect();
    }
    getTenantDb().disconnect();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function createHold(
    ctx: TenantContext,
    fixture: TenantFixture,
    sessionId: string,
    options: { startsAt?: Date; now?: Date; staffId?: string | null } = {},
  ) {
    return createBookingHold({
      ctx,
      serviceId: fixture.serviceId,
      staffId: options.staffId ?? null,
      startsAt: options.startsAt ?? startsAt,
      // Sem sessão: o hold nasce anônimo, sem cliente no banco.
      customerId: null,
      holdSessionId: sessionId,
      authenticated: false,
      now: options.now ?? now,
    });
  }

  it('monta a grade e identifica o dia no fuso do tenant', async () => {
    const loaded = await loadDayState(ctxA, tenantA.serviceId, null, TARGET_DATE);
    expect(loaded).not.toBeNull();
    const slots = buildSlotOptions(loaded!, now);
    expect(slots.map((slot) => slot.label)).toContain('09:00');

    // 21:00 em Brasília é 00:00Z do dia seguinte; o dia precisa continuar sendo
    // o do tenant, nunca o de UTC (bug histórico).
    const late = fromZonedTime(`${TARGET_DATE}T21:00:00`, TZ);
    expect(dayOfInstant(late, TZ)).toBe(TARGET_DATE);
  });

  it('cria o hold anônimo e vincula o cliente na confirmação', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-1', { startsAt: slotAt('09:00') });
    expect(hold.staffName).toBe('Profissional');

    const stored = await ctxA.forTenant((tx) =>
      tx.booking.findFirstOrThrow({ where: { id: hold.holdId }, select: { status: true, customerId: true } }),
    );
    expect(stored.status).toBe('HOLD');
    // Ninguém falso no banco: a ausência é honesta enquanto é HOLD.
    expect(stored.customerId).toBeNull();

    const first = await confirmCustomerHold({
      ctx: ctxA,
      holdId: hold.holdId,
      holdSessionId: 'device-a-1',
      memberId: tenantA.customerId,
      now,
    });
    expect(first.alreadyConfirmed).toBe(false);

    const after = await ctxA.forTenant((tx) =>
      tx.booking.findFirstOrThrow({
        where: { id: hold.holdId },
        select: { status: true, customerId: true },
      }),
    );
    expect(after.status).toBe('CONFIRMED');
    expect(after.customerId).toBe(tenantA.customerId);
  });

  it('clique duplo sequencial: a segunda resposta é sucesso com o MESMO agendamento', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-2', { startsAt: slotAt('09:45') });

    const first = await confirmCustomerHold({
      ctx: ctxA,
      holdId: hold.holdId,
      holdSessionId: 'device-a-2',
      memberId: tenantA.customerId,
      now,
    });
    const second = await confirmCustomerHold({
      ctx: ctxA,
      holdId: hold.holdId,
      holdSessionId: 'device-a-2',
      memberId: tenantA.customerId,
      now,
    });

    expect(first.alreadyConfirmed).toBe(false);
    expect(second.alreadyConfirmed).toBe(true);
    expect(second.hold.holdId).toBe(hold.holdId);
  });

  it('clique duplo concorrente: as duas respostas são sucesso e há um único CONFIRMED', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-2b', { startsAt: slotAt('10:30') });

    const results = await Promise.all([
      confirmCustomerHold({
        ctx: ctxA,
        holdId: hold.holdId,
        holdSessionId: 'device-a-2b',
        memberId: tenantA.customerId,
        now,
      }),
      confirmCustomerHold({
        ctx: ctxA,
        holdId: hold.holdId,
        holdSessionId: 'device-a-2b',
        memberId: tenantA.customerId,
        now,
      }),
    ]);

    expect(results.map((result) => result.hold.holdId)).toEqual([hold.holdId, hold.holdId]);

    const count = await ctxA.forTenant((tx) =>
      tx.booking.count({ where: { id: hold.holdId, status: 'CONFIRMED' } }),
    );
    expect(count).toBe(1);
  });

  it('confirmação de um cliente diferente não se apropria do agendamento', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-3', { startsAt: slotAt('11:15') });
    await confirmCustomerHold({
      ctx: ctxA,
      holdId: hold.holdId,
      holdSessionId: 'device-a-3',
      memberId: tenantA.customerId,
      now,
    });

    const other = await admin.asPlatformAdmin(async (tx) => {
      const otherUser = await tx.user.create({ data: { phone: phone(), name: 'Outro' } });
      return tx.tenantMember.create({
        data: { tenantId: tenantA.tenantId, userId: otherUser.id, role: 'CUSTOMER' },
      });
    });

    await expect(
      confirmCustomerHold({
        ctx: ctxA,
        holdId: hold.holdId,
        holdSessionId: 'device-a-3',
        memberId: other.id,
        now,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('hold sem a sessão dona não pode ser confirmado', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-4', { startsAt: slotAt('12:00') });
    await expect(
      confirmCustomerHold({
        ctx: ctxA,
        holdId: hold.holdId,
        holdSessionId: 'outro-dispositivo',
        memberId: tenantA.customerId,
        now,
      }),
    ).rejects.toBeInstanceOf(PortalBookingError);
  });

  it('hold vencido com a linha viva AINDA confirma: garantia, não prazo de validade', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-5', { startsAt: slotAt('12:45') });
    const expiredNow = new Date(now.getTime() + 11 * MINUTE);

    const result = await confirmCustomerHold({
      ctx: ctxA,
      holdId: hold.holdId,
      holdSessionId: 'device-a-5',
      memberId: tenantA.customerId,
      now: expiredNow,
    });
    expect(result.alreadyConfirmed).toBe(false);

    const stored = await ctxA.forTenant((tx) =>
      tx.booking.findFirstOrThrow({
        where: { id: hold.holdId },
        select: { status: true, customerId: true },
      }),
    );
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.customerId).toBe(tenantA.customerId);
  });

  it('hold recolhido por outro cliente volta à grade e a confirmação falha com BOOKING_NOT_FOUND', async () => {
    const hold = await createHold(ctxA, tenantA, 'device-a-6', { startsAt: slotAt('14:15') });

    // É o que a criação do próximo hold faz na mesma transação: recolhe o
    // vencido. Sem a linha, o horário pode ter ido para outra pessoa.
    await ctxA.forTenant((tx) => tx.booking.deleteMany({ where: { id: hold.holdId } }));

    await expect(
      confirmCustomerHold({
        ctx: ctxA,
        holdId: hold.holdId,
        holdSessionId: 'device-a-6',
        memberId: tenantA.customerId,
        now: new Date(now.getTime() + 11 * MINUTE),
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    const loaded = await loadDayState(ctxA, tenantA.serviceId, null, TARGET_DATE);
    const slots = buildSlotOptions(loaded!, new Date(now.getTime() + 11 * MINUTE));
    expect(slots.map((slot) => slot.value)).toContain(slotAt('14:15').toISOString());
  });

  it('portal do tenant A não cria hold nem confirma dado do tenant B', async () => {
    const holdA = await createHold(ctxA, tenantA, 'device-iso', { startsAt: slotAt('13:30') });

    const seenByB = await ctxB.forTenant((tx) =>
      tx.booking.findUnique({ where: { id: holdA.holdId }, select: { id: true } }),
    );
    expect(seenByB).toBeNull();

    await expect(
      confirmCustomerHold({
        ctx: ctxB,
        holdId: holdA.holdId,
        holdSessionId: 'device-iso',
        memberId: tenantB.customerId,
        now,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    // Serviço do tenant A é invisível para o B — a RLS responde vazio.
    await expect(
      createBookingHold({
        ctx: ctxB,
        serviceId: tenantA.serviceId,
        staffId: null,
        startsAt,
        customerId: null,
        holdSessionId: 'device-iso-b',
        authenticated: false,
        now,
      }),
    ).rejects.toBeInstanceOf(PortalBookingError);
  });
});
