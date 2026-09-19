// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { BookingStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  processPaymentWebhook,
  WebhookProcessingError,
} from '@/app/api/webhooks/payments/processor';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore, type MockPaymentStore } from '@/lib/payments/mock-store';
import { refundPayment } from '@/lib/payments/refund';
import { loadFinancialOverview } from '@/lib/payments/statement';
import { parsePaymentWebhookEvent, type WebhookDeliveryRequest } from '@/lib/payments/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Saldo, extrato e estorno (F4.3), com o mock de verdade entregando o webhook
 * no processador real. Prova os quatro "pronto quando":
 *   1. o estorno gera lançamento e o webhook correspondente é tratado;
 *   2. reentrega do webhook de estorno não estorna duas vezes;
 *   3. o extrato de um tenant não aparece no outro;
 *   4. o saldo local bate com o `getBalance` do mock.
 *
 * O transporte do mock chama `processPaymentWebhook` — o mesmo núcleo da rota —
 * para que a entrega seja um POST de verdade, e cada corpo entregue é lembrado
 * para a limpeza de `WebhookEvent` no fim.
 */

const AMOUNT = 5000;
const SECRET = 'statement-secret';
const runId = randomUUID().slice(0, 8);

interface Scenario {
  fixture: TenantFixture;
  provider: MockPaymentProvider;
  store: MockPaymentStore;
  accountId: string;
  bookingId: string;
  paymentId: string;
  chargeId: string;
  deliveries: WebhookDeliveryRequest[];
}

describe('saldo, extrato e estorno', () => {
  let admin: TenantDb;
  const scenarios: Scenario[] = [];
  // Store único para todos os cenários: os ids do mock são sequenciais
  // (`chg_mock_1`, `chg_mock_2`, …) e stores por cenário colidiriam os
  // `asaasId`, fazendo o webhook de um tenant cair no pagamento de outro.
  const sharedStore = createMockPaymentStore();

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
  }, 180_000);

  afterAll(async () => {
    if (!admin) return;
    const eventIds: string[] = [];
    for (const scenario of scenarios) {
      await deleteTenant(admin, scenario.fixture.tenantId);
      for (const delivery of scenario.deliveries) {
        const event = parsePaymentWebhookEvent(delivery.body);
        if (event) eventIds.push(event.eventId);
      }
    }
    if (eventIds.length > 0) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }),
      );
    }
    await admin.disconnect();
  });

  const db = { forTenant };

  async function openScenario(options: {
    bookingStatus?: BookingStatus;
    cancelledHoursBefore?: number;
  } = {}): Promise<Scenario> {
    const fixture = await createTenantFixture(admin, `f43-${runId}`);
    const store = sharedStore;
    const deliveries: WebhookDeliveryRequest[] = [];
    const provider = new MockPaymentProvider({
      store,
      transport: {
        async deliver(request) {
          deliveries.push(request);
          const event = parsePaymentWebhookEvent(request.body);
          if (!event) return { ok: false, status: 400 };
          try {
            await processPaymentWebhook(event, request.body);
            return { ok: true, status: 200 };
          } catch (error) {
            const status = error instanceof WebhookProcessingError ? error.status : 500;
            return { ok: false, status };
          }
        },
      },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: SECRET,
    });

    const account = await provider.createMerchantAccount({
      name: 'Barbearia F4.3',
      document: '12345678909',
    });

    await forTenant(fixture.tenantId, (tx) =>
      tx.asaasAccount.create({
        data: {
          tenantId: fixture.tenantId,
          asaasAccountId: account.accountId,
          walletId: account.walletId,
          apiKeyEnc: 'v1.test',
          pixKey: 'pix@teste.dev',
          kycStatus: 'APPROVED',
        },
      }),
    );

    await provider.simulateKycDecision(account.accountId, 'APPROVED');

    const startsAt = new Date(Date.UTC(2027, 5, 1, 12, 0, 0));
    const cancelledHoursBefore = options.cancelledHoursBefore ?? 48;
    const bookingStatus = options.bookingStatus ?? 'CANCELLED';
    const booking = await forTenant(fixture.tenantId, (tx) =>
      tx.booking.create({
        data: {
          tenantId: fixture.tenantId,
          customerId: fixture.customerMemberId,
          staffId: fixture.staffId,
          serviceId: fixture.serviceId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
          status: bookingStatus,
          ...(bookingStatus === 'CANCELLED'
            ? {
                cancelledAt: new Date(startsAt.getTime() - cancelledHoursBefore * 3_600_000),
                cancellationReason: 'customer',
              }
            : {}),
          priceCents: AMOUNT,
          source: 'PORTAL',
        },
      }),
    );

    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: fixture.customerMemberId,
      method: 'PIX',
      amountCents: AMOUNT,
      dueDate: '2030-01-15',
    });

    const payment = await forTenant(fixture.tenantId, (tx) =>
      tx.payment.create({
        data: {
          tenantId: fixture.tenantId,
          bookingId: booking.id,
          provider: 'mock',
          method: 'PIX',
          amountCents: AMOUNT,
          status: 'PENDING',
          asaasId: charge.id,
        },
      }),
    );

    const scenario: Scenario = {
      fixture,
      provider,
      store,
      accountId: account.accountId,
      bookingId: booking.id,
      paymentId: payment.id,
      chargeId: charge.id,
      deliveries,
    };
    scenarios.push(scenario);
    return scenario;
  }

  async function markPaid(scenario: Scenario): Promise<void> {
    const result = await scenario.provider.simulateChargePaid(scenario.chargeId);
    expect(result.delivered).toBe(true);
  }

  async function readPayment(paymentId: string, tenantId: string) {
    return forTenant(tenantId, (tx) =>
      tx.payment.findFirst({ where: { id: paymentId }, select: { status: true } }),
    );
  }

  async function refundCents(tenantId: string, paymentId: string): Promise<number> {
    const aggregate = await forTenant(tenantId, (tx) =>
      tx.refund.aggregate({ where: { paymentId }, _sum: { amountCents: true } }),
    );
    return aggregate._sum.amountCents ?? 0;
  }

  it('estorno integral gera lançamento, muda o estado e zera o disponível', async () => {
    const scenario = await openScenario();
    await markPaid(scenario);

    const before = await loadFinancialOverview(db, scenario.fixture.tenantId);
    expect(before.availableCents).toBe(AMOUNT);
    expect(before.refundedCents).toBe(0);

    const result = await refundPayment({
      db,
      tenantId: scenario.fixture.tenantId,
      paymentId: scenario.paymentId,
      provider: scenario.provider,
    });

    expect(result.amountCents).toBe(AMOUNT);
    expect(result.policy).toBe('ELIGIBLE');
    expect(await refundCents(scenario.fixture.tenantId, scenario.paymentId)).toBe(AMOUNT);
    expect((await readPayment(scenario.paymentId, scenario.fixture.tenantId))?.status).toBe(
      'REFUNDED',
    );

    const after = await loadFinancialOverview(db, scenario.fixture.tenantId);
    expect(after.availableCents).toBe(0);
    expect(after.refundedCents).toBe(AMOUNT);
    expect(after.entries.filter((entry) => entry.kind === 'REFUND')).toHaveLength(1);
  });

  it('estorno parcial repete e fecha o total sem estourar', async () => {
    const scenario = await openScenario();
    await markPaid(scenario);

    await refundPayment({
      db,
      tenantId: scenario.fixture.tenantId,
      paymentId: scenario.paymentId,
      amountCents: 2000,
      provider: scenario.provider,
    });
    expect(await refundCents(scenario.fixture.tenantId, scenario.paymentId)).toBe(2000);
    expect((await readPayment(scenario.paymentId, scenario.fixture.tenantId))?.status).toBe(
      'PARTIALLY_REFUNDED',
    );

    await refundPayment({
      db,
      tenantId: scenario.fixture.tenantId,
      paymentId: scenario.paymentId,
      amountCents: 3000,
      provider: scenario.provider,
    });
    expect(await refundCents(scenario.fixture.tenantId, scenario.paymentId)).toBe(AMOUNT);
    expect((await readPayment(scenario.paymentId, scenario.fixture.tenantId))?.status).toBe(
      'REFUNDED',
    );

    const overview = await loadFinancialOverview(db, scenario.fixture.tenantId);
    expect(overview.availableCents).toBe(0);
    expect(overview.refundedCents).toBe(AMOUNT);
    expect(overview.entries.filter((entry) => entry.kind === 'REFUND')).toHaveLength(2);
  });

  it('reentrega do webhook de estorno não estorna duas vezes', async () => {
    const scenario = await openScenario();
    await markPaid(scenario);
    await refundPayment({
      db,
      tenantId: scenario.fixture.tenantId,
      paymentId: scenario.paymentId,
      provider: scenario.provider,
    });

    const refundDelivery = scenario.deliveries.at(-1);
    expect(refundDelivery).toBeDefined();

    const event = parsePaymentWebhookEvent(refundDelivery!.body);
    expect(event).not.toBeNull();
    const repeated = await processPaymentWebhook(event!, refundDelivery!.body);

    expect(repeated.status).toBe(200);
    expect(repeated.body.duplicate).toBe(true);
    expect(await refundCents(scenario.fixture.tenantId, scenario.paymentId)).toBe(AMOUNT);
  });

  it('política de cancelamento bloqueia estorno fora da janela', async () => {
    const scenario = await openScenario({ cancelledHoursBefore: 1 });
    await markPaid(scenario);

    await expect(
      refundPayment({
        db,
        tenantId: scenario.fixture.tenantId,
        paymentId: scenario.paymentId,
        provider: scenario.provider,
      }),
    ).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });

    expect(await refundCents(scenario.fixture.tenantId, scenario.paymentId)).toBe(0);
  });

  it('o extrato de um tenant nunca aparece no outro', async () => {
    const a = await openScenario();
    const b = await openScenario();
    await markPaid(a);
    await markPaid(b);
    await refundPayment({
      db,
      tenantId: a.fixture.tenantId,
      paymentId: a.paymentId,
      provider: a.provider,
    });

    const overviewA = await loadFinancialOverview(db, a.fixture.tenantId);
    const overviewB = await loadFinancialOverview(db, b.fixture.tenantId);

    const idsA = overviewA.entries.map((entry) => entry.paymentId);
    const idsB = overviewB.entries.map((entry) => entry.paymentId);

    expect(idsA).toContain(a.paymentId);
    expect(idsA).not.toContain(b.paymentId);
    expect(idsB).toContain(b.paymentId);
    expect(idsB).not.toContain(a.paymentId);
    expect(overviewB.refundedCents).toBe(0);
  });

  it('o saldo local bate com o getBalance do mock', async () => {
    const scenario = await openScenario();
    await markPaid(scenario);

    const paid = await loadFinancialOverview(db, scenario.fixture.tenantId);
    const balancePaid = await scenario.provider.getBalance(scenario.accountId);
    expect(paid.availableCents).toBe(balancePaid.availableCents);
    expect(paid.pendingCents).toBe(balancePaid.pendingCents);

    await refundPayment({
      db,
      tenantId: scenario.fixture.tenantId,
      paymentId: scenario.paymentId,
      amountCents: 1500,
      provider: scenario.provider,
    });

    const refunded = await loadFinancialOverview(db, scenario.fixture.tenantId);
    const balanceRefunded = await scenario.provider.getBalance(scenario.accountId);
    expect(refunded.availableCents).toBe(balanceRefunded.availableCents);
    expect(refunded.pendingCents).toBe(balanceRefunded.pendingCents);
    expect(refunded.availableCents).toBe(AMOUNT - 1500);
  });
});
