// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cancelBooking } from '@/lib/booking/cancel';
import { confirmBooking, type BookingParticipant } from '@/lib/booking/confirm';
import { createHold } from '@/lib/booking/hold';
import { onBookingCancelled } from '@/lib/booking/participants/credits';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  CREDIT_REASON,
  InsufficientCreditError,
  applyCreditForBooking,
  consumeCreditForBooking,
  decideCreditBooking,
  expireUnusedCycleCredits,
  findCreditCoverage,
  getServiceCreditBalance,
  listCreditBalances,
  refundCreditForBooking,
  renewCycleCredits,
} from '@/lib/membership/credits';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Créditos do clube (tarefa F5.2), contra Postgres real e a role SEM superuser
 * (`kg_rls_app`), para a RLS valer de fato. Prova os critérios de pronto:
 *
 *   - saldo é a SOMA do ledger append-only;
 *   - consumo atômico com a confirmação, sem crédito fantasma;
 *   - concorrência: dois agendamentos com UM crédito, um passa e um falha;
 *   - cancelamento devolve como LANÇAMENTO NOVO e o ledger conta a história;
 *   - assinante de A é invisível no B;
 *   - a flag de sinal do tenant é respeitada nos dois caminhos.
 */

describe('créditos do clube', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const createdTenants: string[] = [];
  let slotSeed = 0;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of createdTenants) await deleteTenant(admin, tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  async function freshTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  interface SeededMembership {
    membershipId: string;
    planId: string;
  }

  async function seedMembership(
    fixture: TenantFixture,
    options: { balance?: number; requiresDeposit?: boolean } = {},
  ): Promise<SeededMembership> {
    return admin.asPlatformAdmin(async (tx) => {
      const plan = await tx.membershipPlan.create({
        data: {
          tenantId: fixture.tenantId,
          name: 'Clube do salão',
          priceCents: 7900,
          cycle: 'MONTHLY',
        },
      });
      await tx.membershipBenefit.create({
        data: {
          tenantId: fixture.tenantId,
          planId: plan.id,
          serviceId: fixture.serviceId,
          quantityPerCycle: 2,
        },
      });
      const membership = await tx.membership.create({
        data: {
          tenantId: fixture.tenantId,
          customerId: fixture.customerMemberId,
          planId: plan.id,
          status: 'ACTIVE',
          contractedPriceCents: 6900,
        },
      });
      if (options.balance && options.balance > 0) {
        await tx.creditLedger.create({
          data: {
            tenantId: fixture.tenantId,
            membershipId: membership.id,
            serviceId: fixture.serviceId,
            delta: options.balance,
            reason: CREDIT_REASON.cycleGrant,
          },
        });
      }
      if (options.requiresDeposit) {
        await tx.tenant.update({
          where: { id: fixture.tenantId },
          data: { membershipRequiresDeposit: true },
        });
      }
      return { membershipId: membership.id, planId: plan.id };
    });
  }

  /** Slot único e distante do agendamento default da fixture (2026-11-03). */
  function nextSlot(): Date {
    slotSeed += 1;
    return new Date(Date.UTC(2027, 0, 1 + slotSeed, 9, 0, 0));
  }

  async function newHold(fixture: TenantFixture, label: string): Promise<string> {
    const hold = await createHold({
      tenantId: fixture.tenantId,
      customerId: fixture.customerMemberId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      startsAt: nextSlot(),
      holdSessionId: `session-${label}-${slotSeed}`,
    });
    return hold.id;
  }

  async function ledgerRows(fixture: TenantFixture, bookingId: string) {
    return scoped.forTenant(fixture.tenantId, (tx) =>
      tx.creditLedger.findMany({
        where: { tenantId: fixture.tenantId, bookingId },
        orderBy: { createdAt: 'asc' },
        select: { delta: true, reason: true },
      }),
    );
  }

  it('consome na confirmação e o saldo é a soma do ledger', async () => {
    const fixture = await freshTenant('credit-consume');
    const { membershipId } = await seedMembership(fixture, { balance: 2 });
    const bookingId = await newHold(fixture, 'consume');

    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      customerId: fixture.customerMemberId,
      handlers: [],
    });
    expect(result.booking.status).toBe('CONFIRMED');

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(1);

    const rows = await ledgerRows(fixture, bookingId);
    expect(rows).toEqual([{ delta: -1, reason: CREDIT_REASON.bookingConsumed }]);
  });

  it('serviço pago adiantado com crédito confirma sem cobrança (checkout pulado)', async () => {
    const fixture = await freshTenant('credit-skip-checkout');
    await admin.asPlatformAdmin((tx) =>
      tx.service.update({
        where: { id: fixture.serviceId },
        data: { paymentMode: 'FULL_PREPAID' },
      }),
    );
    const { membershipId } = await seedMembership(fixture, { balance: 1 });
    const bookingId = await newHold(fixture, 'skip-checkout');

    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      customerId: fixture.customerMemberId,
      handlers: [],
    });
    expect(result.booking.status).toBe('CONFIRMED');

    const paymentCount = await scoped.forTenant(fixture.tenantId, (tx) =>
      tx.payment.count({ where: { tenantId: fixture.tenantId, bookingId } }),
    );
    expect(paymentCount).toBe(0);

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(0);
  });

  it('nunca debita duas vezes para o mesmo agendamento', async () => {
    const fixture = await freshTenant('credit-idempotent');
    await seedMembership(fixture, { balance: 2 });
    const bookingId = await newHold(fixture, 'idempotent');

    const outcomes = await scoped.forTenant(fixture.tenantId, async (tx) => {
      const first = await applyCreditForBooking(tx, {
        tenantId: fixture.tenantId,
        bookingId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
      });
      const second = await applyCreditForBooking(tx, {
        tenantId: fixture.tenantId,
        bookingId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
      });
      return { first, second };
    });

    expect(outcomes.first).toMatchObject({ kind: 'consumed' });
    expect(outcomes.second).toMatchObject({ kind: 'already-consumed' });
    expect((await ledgerRows(fixture, bookingId)).length).toBe(1);
  });

  it('duas confirmações simultâneas do MESMO agendamento debitam uma vez só', async () => {
    const fixture = await freshTenant('credit-same-booking');
    await seedMembership(fixture, { balance: 2 });
    const bookingId = await newHold(fixture, 'same-booking');

    const attempt = () =>
      scoped.forTenant(fixture.tenantId, (tx) =>
        applyCreditForBooking(tx, {
          tenantId: fixture.tenantId,
          bookingId,
          customerId: fixture.customerMemberId,
          serviceId: fixture.serviceId,
        }),
      );

    const outcomes = await Promise.all([attempt(), attempt()]);
    const kinds = outcomes.map((outcome) => outcome.kind).sort();
    expect(kinds).toEqual(['already-consumed', 'consumed']);

    expect((await ledgerRows(fixture, bookingId)).length).toBe(1);
  });

  it('concorrência: dois agendamentos com UM crédito — um passa, um falha', async () => {
    const fixture = await freshTenant('credit-race');
    const { membershipId } = await seedMembership(fixture, { balance: 1 });
    const bookingA = await newHold(fixture, 'race-a');
    const bookingB = await newHold(fixture, 'race-b');

    const attempt = (bookingId: string) =>
      scoped.forTenant(fixture.tenantId, (tx) =>
        consumeCreditForBooking(tx, {
          tenantId: fixture.tenantId,
          bookingId,
          customerId: fixture.customerMemberId,
          serviceId: fixture.serviceId,
        }),
      );

    const results = await Promise.allSettled([attempt(bookingA), attempt(bookingB)]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditError);

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(0);

    const consumed = await scoped.forTenant(fixture.tenantId, (tx) =>
      tx.creditLedger.count({
        where: { tenantId: fixture.tenantId, reason: CREDIT_REASON.bookingConsumed },
      }),
    );
    expect(consumed).toBe(1);
  });

  it('concorrência na confirmação: crédito consumido por um participante estrito', async () => {
    const fixture = await freshTenant('credit-race-confirm');
    await seedMembership(fixture, { balance: 1 });
    const bookingA = await newHold(fixture, 'race-confirm-a');
    const bookingB = await newHold(fixture, 'race-confirm-b');

    // O fluxo que pula o checkout injeta o consumo ESTRITO: a decisão de usar o
    // crédito já foi tomada, então perder a corrida tem de abortar a
    // confirmação — e não confirmar um atendimento sem pagamento e sem crédito.
    const strictCredit: BookingParticipant = async (tx, context) => {
      await consumeCreditForBooking(tx, {
        tenantId: context.tenantId,
        bookingId: context.bookingId,
        customerId: context.customerId,
        serviceId: context.serviceId,
      });
    };

    const confirm = (bookingId: string) =>
      confirmBooking({
        tenantId: fixture.tenantId,
        bookingId,
        customerId: fixture.customerMemberId,
        participants: [strictCredit],
        handlers: [],
      });

    const results = await Promise.allSettled([confirm(bookingA), confirm(bookingB)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditError);

    const statuses = await scoped.forTenant(fixture.tenantId, (tx) =>
      tx.booking.findMany({
        where: { id: { in: [bookingA, bookingB] } },
        select: { status: true },
      }),
    );
    expect(statuses.filter((row) => row.status === 'CONFIRMED')).toHaveLength(1);
    expect(statuses.filter((row) => row.status === 'HOLD')).toHaveLength(1);
  });

  it('cancelar dentro da política devolve o crédito como lançamento novo', async () => {
    const fixture = await freshTenant('credit-refund');
    const { membershipId } = await seedMembership(fixture, { balance: 1 });
    const bookingId = await newHold(fixture, 'refund');

    await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      customerId: fixture.customerMemberId,
      handlers: [],
    });

    await cancelBooking({
      tenantId: fixture.tenantId,
      bookingId,
      bypassWindow: true,
      handlers: [onBookingCancelled],
    });

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(1);

    const rows = await ledgerRows(fixture, bookingId);
    expect(rows).toEqual([
      { delta: -1, reason: CREDIT_REASON.bookingConsumed },
      { delta: 1, reason: CREDIT_REASON.bookingRefunded },
    ]);

    // Reentrega do cancelamento não credita de novo: o estorno é idempotente.
    const again = await scoped.forTenant(fixture.tenantId, (tx) =>
      refundCreditForBooking(tx, fixture.tenantId, bookingId),
    );
    expect(again).toMatchObject({ kind: 'already-refunded' });
    const balanceAfter = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balanceAfter).toBe(1);
  });

  it('renovação expira o que sobrou e credita o ciclo novo (não acumula)', async () => {
    const fixture = await freshTenant('credit-renew');
    const { membershipId, planId } = await seedMembership(fixture, { balance: 2 });

    const result = await scoped.forTenant(fixture.tenantId, (tx) =>
      renewCycleCredits(tx, fixture.tenantId, membershipId, planId),
    );
    expect(result.expired).toBe(2);
    expect(result.granted).toEqual([{ serviceId: fixture.serviceId, quantityPerCycle: 2 }]);

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(2);

    const reasons = await scoped.forTenant(fixture.tenantId, (tx) =>
      tx.creditLedger.findMany({
        where: { tenantId: fixture.tenantId, membershipId },
        orderBy: { createdAt: 'asc' },
        select: { delta: true, reason: true },
      }),
    );
    expect(reasons).toEqual([
      { delta: 2, reason: CREDIT_REASON.cycleGrant },
      { delta: -2, reason: CREDIT_REASON.cycleExpired },
      { delta: 2, reason: CREDIT_REASON.cycleGrant },
    ]);
  });

  it('flag de sinal: false dispensa, true exige — sem crédito não inventa sinal', async () => {
    const fixture = await freshTenant('credit-deposit');
    await seedMembership(fixture, { balance: 1 });

    const falseCase = await scoped.forTenant(fixture.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: fixture.tenantId },
        select: { membershipRequiresDeposit: true },
      });
      return decideCreditBooking(tx, {
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
        membershipRequiresDeposit: tenant.membershipRequiresDeposit,
      });
    });
    expect(falseCase).toMatchObject({ useCredit: true, requiresDeposit: false });

    await admin.asPlatformAdmin((tx) =>
      tx.tenant.update({
        where: { id: fixture.tenantId },
        data: { membershipRequiresDeposit: true },
      }),
    );

    const trueCase = await scoped.forTenant(fixture.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: fixture.tenantId },
        select: { membershipRequiresDeposit: true },
      });
      return decideCreditBooking(tx, {
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
        membershipRequiresDeposit: tenant.membershipRequiresDeposit,
      });
    });
    expect(trueCase).toMatchObject({ useCredit: true, requiresDeposit: true });

    // Saldo zerado: a flag não cria sinal onde não há crédito.
    await scoped.forTenant(fixture.tenantId, (tx) =>
      expireUnusedCycleCredits(tx, fixture.tenantId, trueCase.membershipId as string),
    );

    const zeroCase = await scoped.forTenant(fixture.tenantId, (tx) =>
      decideCreditBooking(tx, {
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
        membershipRequiresDeposit: true,
      }),
    );
    expect(zeroCase).toMatchObject({ useCredit: false, requiresDeposit: false, balance: 0 });
  });

  it('sem clube, a confirmação segue normal e não escreve no ledger', async () => {
    const fixture = await freshTenant('credit-none');
    const bookingId = await newHold(fixture, 'none');

    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      customerId: fixture.customerMemberId,
      handlers: [],
    });
    expect(result.booking.status).toBe('CONFIRMED');

    const rows = await ledgerRows(fixture, bookingId);
    expect(rows).toEqual([]);

    const coverage = await scoped.forTenant(fixture.tenantId, (tx) =>
      findCreditCoverage(tx, fixture.tenantId, fixture.customerMemberId, fixture.serviceId),
    );
    expect(coverage).toBeNull();
  });

  it('cobrança existente bloqueia o consumo de crédito', async () => {
    const fixture = await freshTenant('credit-paid');
    const { membershipId } = await seedMembership(fixture, { balance: 1 });
    const bookingId = await newHold(fixture, 'paid');

    await admin.asPlatformAdmin((tx) =>
      tx.payment.create({
        data: {
          tenantId: fixture.tenantId,
          bookingId,
          provider: 'mock',
          method: 'PIX',
          amountCents: 5000,
          status: 'PENDING',
        },
      }),
    );

    const outcome = await scoped.forTenant(fixture.tenantId, (tx) =>
      applyCreditForBooking(tx, {
        tenantId: fixture.tenantId,
        bookingId,
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
      }),
    );
    expect(outcome).toMatchObject({ kind: 'no-credit' });

    const balance = await scoped.forTenant(fixture.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixture.tenantId, membershipId, fixture.serviceId),
    );
    expect(balance).toBe(1);
  });

  it('assinante de A é invisível no B (RLS + escopo explícito)', async () => {
    const fixtureA = await freshTenant('credit-iso-a');
    const fixtureB = await freshTenant('credit-iso-b');
    const seededA = await seedMembership(fixtureA, { balance: 1 });

    const aBalanceFromB = await scoped.forTenant(fixtureB.tenantId, (tx) =>
      getServiceCreditBalance(tx, fixtureB.tenantId, seededA.membershipId, fixtureA.serviceId),
    );
    expect(aBalanceFromB).toBe(0);

    const balancesFromB = await scoped.forTenant(fixtureB.tenantId, (tx) =>
      listCreditBalances(tx, fixtureB.tenantId, seededA.membershipId),
    );
    expect(balancesFromB).toEqual([]);

    const coverageForB = await scoped.forTenant(fixtureB.tenantId, (tx) =>
      findCreditCoverage(tx, fixtureB.tenantId, fixtureB.customerMemberId, fixtureB.serviceId),
    );
    expect(coverageForB).toBeNull();
  });
});
