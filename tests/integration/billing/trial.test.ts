import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHold } from '@/lib/booking/hold';
import { confirmBooking, type BookingParticipant } from '@/lib/booking/confirm';
import { rescheduleBooking } from '@/lib/booking/reschedule';
import { participant as trialParticipant } from '@/lib/booking/participants/trial-counter';
import {
  TRIAL_BOOKING_LIMIT,
  TrialLimitError,
  getTrialStatus,
} from '@/lib/billing/trial';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Trial por valor (tarefa F7.1, spec §6.2), com Postgres real:
 *
 *   - hold abandonado NÃO consome trial (conta na confirmação);
 *   - confirmação conta uma vez; retry do participante não conta dobrado;
 *   - o 8º agendamento vira aviso amigável;
 *   - o 11º bloqueia NOVOS agendamentos sem apagar nem esconder os existentes;
 *   - remarcação não consome trial de novo;
 *   - tenant convertido não é bloqueado;
 *   - o contador não vaza entre tenants.
 */

describe('billing: trial por valor', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const tenants: string[] = [];
  let slotSeed = 0;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterAll(async () => {
    for (const tenantId of tenants) {
      await deleteTenant(admin, tenantId);
    }
    await scoped?.disconnect();
    await admin?.disconnect();
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const tenant = await createTenantFixture(admin, prefix);
    tenants.push(tenant.tenantId);
    return tenant;
  }

  /** Instante único por chamada, longe do hold do fixture (2026-11-03). */
  function slotAt(): Date {
    slotSeed += 1;
    return new Date(Date.UTC(2026, 11, 1 + slotSeed, 9, 0, 0));
  }

  async function usedOf(tenantId: string): Promise<number> {
    const tenant = await scoped.forTenant(tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { trialBookingsUsed: true },
      }),
    );
    return tenant.trialBookingsUsed;
  }

  async function setUsed(tenantId: string, used: number): Promise<void> {
    await admin.asPlatformAdmin((tx) =>
      tx.tenant.update({
        where: { id: tenantId },
        data: { trialBookingsUsed: used },
      }),
    );
  }

  async function newHold(
    fixture: TenantFixture,
    session: string,
    startsAt = slotAt(),
  ): Promise<string> {
    const hold = await createHold({
      tenantId: fixture.tenantId,
      customerId: fixture.customerMemberId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      startsAt,
      holdSessionId: session,
    });
    return hold.id;
  }

  async function newConfirmedBooking(
    fixture: TenantFixture,
    session: string,
    startsAt = slotAt(),
  ): Promise<string> {
    const bookingId = await newHold(fixture, session, startsAt);
    await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      customerId: fixture.customerMemberId,
    });
    return bookingId;
  }

  it('hold abandonado não consome trial', async () => {
    const tenant = await makeTenant('trial-hold');

    await newHold(tenant, 'abandoned');

    expect(await usedOf(tenant.tenantId)).toBe(0);
  });

  it('conta na confirmação, uma única vez por agendamento', async () => {
    const tenant = await makeTenant('trial-once');
    const bookingId = await newConfirmedBooking(tenant, 'once');

    expect(await usedOf(tenant.tenantId)).toBe(1);

    // Reconfirmar o mesmo agendamento esbarra no estado antes de qualquer
    // participante: não conta de novo.
    await expect(
      confirmBooking({
        tenantId: tenant.tenantId,
        bookingId,
        customerId: tenant.customerMemberId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(await usedOf(tenant.tenantId)).toBe(1);
  });

  it('reexecuta o participante sem contar dobrado sob retry (P2034)', async () => {
    const tenant = await makeTenant('trial-retry');
    const bookingId = await newHold(tenant, 'retry');

    let calls = 0;
    const flaky: BookingParticipant = async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('simulated serialization failure'), { code: 'P2034' });
      }
    };

    await confirmBooking({
      tenantId: tenant.tenantId,
      bookingId,
      customerId: tenant.customerMemberId,
      participants: [trialParticipant, flaky],
      handlers: [],
    });

    expect(calls).toBe(2);
    expect(await usedOf(tenant.tenantId)).toBe(1);
  });

  it('no 8º agendamento, emite aviso amigável convidando a escolher plano', async () => {
    const tenant = await makeTenant('trial-warning');
    await setUsed(tenant.tenantId, 7);

    await newConfirmedBooking(tenant, 'warning');

    const status = await scoped.forTenant(tenant.tenantId, (tx) =>
      getTrialStatus(tx, tenant.tenantId),
    );
    expect(status).toMatchObject({
      used: 8,
      limit: TRIAL_BOOKING_LIMIT,
      remaining: 2,
      phase: 'WARNING',
      converted: false,
    });
    expect(status.message).toContain('plano');
    expect(status.upgrade).not.toBeNull();
    // Aviso não bloqueia: a criação seguinte continua permitida.
    await expect(newHold(tenant, 'warning-next')).resolves.toBeTruthy();
  });

  it('no 11º, bloqueia novo agendamento e preserva o que já existe', async () => {
    const tenant = await makeTenant('trial-block');
    const existingId = await newConfirmedBooking(tenant, 'block-existing');
    await setUsed(tenant.tenantId, TRIAL_BOOKING_LIMIT);

    const before = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.count({ where: { tenantId: tenant.tenantId } }),
    );

    const error = await newHold(tenant, 'block-new').catch((reason) => reason);
    expect(error).toBeInstanceOf(TrialLimitError);
    expect((error as TrialLimitError).message).toContain('plano');

    const after = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.count({ where: { tenantId: tenant.tenantId } }),
    );
    expect(after).toBe(before);

    // O agendamento confirmado antes do bloqueio continua visível e intacto.
    const preserved = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: existingId }, select: { status: true } }),
    );
    expect(preserved?.status).toBe('CONFIRMED');

    const visible = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.findMany({
        where: { tenantId: tenant.tenantId, status: 'CONFIRMED' },
        select: { id: true },
      }),
    );
    expect(visible.map((booking) => booking.id)).toContain(existingId);
  });

  it('remarcar não consome trial de novo', async () => {
    const tenant = await makeTenant('trial-reschedule');
    const bookingId = await newConfirmedBooking(tenant, 'reschedule-orig');
    expect(await usedOf(tenant.tenantId)).toBe(1);

    await rescheduleBooking({
      tenantId: tenant.tenantId,
      bookingId,
      customerId: tenant.customerMemberId,
      newStartsAt: slotAt(),
      holdSessionId: 'reschedule-new',
      bypassWindow: true,
    });

    expect(await usedOf(tenant.tenantId)).toBe(1);
  });

  it('tenant convertido não é bloqueado nem conta trial', async () => {
    const tenant = await makeTenant('trial-converted');
    await setUsed(tenant.tenantId, TRIAL_BOOKING_LIMIT);
    await admin.asPlatformAdmin((tx) =>
      tx.platformSub.create({
        data: { tenantId: tenant.tenantId, plan: 'SOLO', status: 'ACTIVE' },
      }),
    );

    const status = await scoped.forTenant(tenant.tenantId, (tx) =>
      getTrialStatus(tx, tenant.tenantId),
    );
    expect(status.phase).toBe('CONVERTED');
    expect(status.message).toBeNull();

    const bookingId = await newHold(tenant, 'converted-ok');
    await confirmBooking({
      tenantId: tenant.tenantId,
      bookingId,
      customerId: tenant.customerMemberId,
    });
    expect(await usedOf(tenant.tenantId)).toBe(TRIAL_BOOKING_LIMIT);
  });

  it('não vaza o contador entre tenants', async () => {
    const tenantA = await makeTenant('trial-iso-a');
    const tenantB = await makeTenant('trial-iso-b');
    await setUsed(tenantA.tenantId, TRIAL_BOOKING_LIMIT);

    await expect(newHold(tenantA, 'iso-a-blocked')).rejects.toBeInstanceOf(TrialLimitError);

    await newConfirmedBooking(tenantB, 'iso-b-ok');
    expect(await usedOf(tenantB.tenantId)).toBe(1);
    expect(await usedOf(tenantA.tenantId)).toBe(TRIAL_BOOKING_LIMIT);
  });
});
