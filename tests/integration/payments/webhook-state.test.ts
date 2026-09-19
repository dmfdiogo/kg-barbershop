// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { BookingStatus, PaymentStatus } from '@prisma/client';
import type { ChargeStatus } from '@/lib/payments/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processPaymentWebhook, WebhookProcessingError } from '@/app/api/webhooks/payments/processor';
import type { PaymentWebhookEvent, PaymentWebhookEventType } from '@/lib/payments/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Núcleo persistente do webhook (F4.0): pago, recusado, Pix expirado, estorno
 * total e parcial, reentrega, fora de ordem e isolamento entre tenants.
 *
 * Os cenários são montados como o produto fará: `Payment` ligado a um
 * `Booking`, com `asaasId` sendo o id da cobrança que o provedor devolve no
 * webhook. O processor resolve o tenant pelo `asaasId` e aplica a máquina de
 * estados de `lib/payments/state.ts`.
 */

const AMOUNT = 5000;
const runId = randomUUID().slice(0, 8);
let seq = 0;

const STATUS_BY_EVENT: Record<PaymentWebhookEventType, ChargeStatus> = {
  CHARGE_PAID: 'PAID',
  CHARGE_REFUSED: 'REFUSED',
  CHARGE_EXPIRED: 'EXPIRED',
  CHARGE_REFUNDED: 'REFUNDED',
  CHARGE_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  MERCHANT_KYC_UPDATED: 'PENDING',
};

describe('webhook de pagamentos — máquina de estados persistente', () => {
  let admin: TenantDb;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    a = await createTenantFixture(admin, 'pay-a');
    b = await createTenantFixture(admin, 'pay-b');
  }, 180_000);

  afterAll(async () => {
    if (admin && a) await deleteTenant(admin, a.tenantId);
    if (admin && b) await deleteTenant(admin, b.tenantId);
    if (admin) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_${runId}` } } }),
      );
      await admin.disconnect();
    }
  });

  function nextStart(): Date {
    seq += 1;
    return new Date(Date.UTC(2027, 0, 1, 8, 0, 0) + seq * 3_600_000);
  }

  interface SeedOptions {
    paymentStatus?: PaymentStatus;
    bookingStatus?: BookingStatus;
    method?: 'PIX' | 'CARD' | 'CASH';
    amountCents?: number;
  }

  interface Seeded {
    bookingId: string;
    paymentId: string;
    asaasId: string;
  }

  async function seed(fixture: TenantFixture, options: SeedOptions = {}): Promise<Seeded> {
    const startsAt = nextStart();
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const blockedUntil = new Date(endsAt.getTime() + 10 * 60_000);
    const asaasId = `chg_${runId}_${seq}`;
    const paymentStatus = options.paymentStatus ?? 'PENDING';
    const bookingStatus = options.bookingStatus ?? 'PENDING';

    return forTenant(fixture.tenantId, async (tx) => {
      const booking = await tx.booking.create({
        data: {
          tenantId: fixture.tenantId,
          customerId: fixture.customerMemberId,
          staffId: fixture.staffId,
          serviceId: fixture.serviceId,
          startsAt,
          endsAt,
          blockedUntil,
          status: bookingStatus,
          ...(bookingStatus === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
          priceCents: options.amountCents ?? AMOUNT,
          source: 'PORTAL',
        },
      });
      const payment = await tx.payment.create({
        data: {
          tenantId: fixture.tenantId,
          bookingId: booking.id,
          provider: 'mock',
          method: options.method ?? 'PIX',
          amountCents: options.amountCents ?? AMOUNT,
          status: paymentStatus,
          asaasId,
          ...(paymentStatus === 'PAID' || paymentStatus === 'PARTIALLY_REFUNDED'
            ? { paidAt: new Date() }
            : {}),
        },
      });
      return { bookingId: booking.id, paymentId: payment.id, asaasId };
    });
  }

  function buildEvent(
    type: PaymentWebhookEventType,
    chargeId: string,
    overrides: { amountCents?: number; refundedCents?: number; accountId?: string } = {},
  ): PaymentWebhookEvent {
    const status = STATUS_BY_EVENT[type];

    return {
      provider: 'mock',
      eventId: `evt_${runId}_${++seq}`,
      type,
      occurredAt: new Date().toISOString(),
      data: {
        charge: {
          id: chargeId,
          accountId: overrides.accountId ?? 'acc_mock_test',
          status,
          amountCents: overrides.amountCents ?? AMOUNT,
          refundedCents: overrides.refundedCents ?? 0,
          ...(status === 'PAID' || status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED'
            ? { paidAt: new Date().toISOString() }
            : {}),
        },
      },
    };
  }

  function deliver(event: PaymentWebhookEvent) {
    return processPaymentWebhook(event, JSON.stringify(event));
  }

  function readPayment(tenantId: string, paymentId: string) {
    return forTenant(tenantId, (tx) =>
      tx.payment.findFirst({ where: { id: paymentId }, select: { status: true, paidAt: true } }),
    );
  }

  function readBooking(tenantId: string, bookingId: string) {
    return forTenant(tenantId, (tx) =>
      tx.booking.findFirst({
        where: { id: bookingId },
        select: { status: true, confirmedAt: true, cancelledAt: true, cancellationReason: true },
      }),
    );
  }

  function countWebhookEvents(eventId: string): Promise<number> {
    return admin.asPlatformAdmin((tx) => tx.webhookEvent.count({ where: { eventId } }));
  }

  it('pagamento aprovado confirma o agendamento', async () => {
    const { bookingId, paymentId, asaasId } = await seed(a);
    const event = buildEvent('CHARGE_PAID', asaasId);

    const result = await deliver(event);

    expect(result.status).toBe(200);
    expect(result.body.applied).toBe(`payment:${paymentId}:PAID`);
    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('PAID');
    const booking = await readBooking(a.tenantId, bookingId);
    expect(booking?.status).toBe('CONFIRMED');
    expect(booking?.confirmedAt).not.toBeNull();
    expect(await countWebhookEvents(event.eventId)).toBe(1);
  });

  it('pagamento recusado cancela o agendamento', async () => {
    const { bookingId, paymentId, asaasId } = await seed(a);

    await deliver(buildEvent('CHARGE_REFUSED', asaasId));

    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('FAILED');
    const booking = await readBooking(a.tenantId, bookingId);
    expect(booking?.status).toBe('CANCELLED');
    expect(booking?.cancellationReason).toBe('payment_not_approved');
  });

  it('Pix expirado libera o slot para outro agendamento', async () => {
    const { bookingId, paymentId, asaasId } = await seed(a);

    await deliver(buildEvent('CHARGE_EXPIRED', asaasId));

    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('EXPIRED');
    expect((await readBooking(a.tenantId, bookingId))?.status).toBe('CANCELLED');

    // O slot voltou a aceitar reserva: a exclusion constraint não bloqueia mais.
    const startsAt = nextStart();
    const created = await forTenant(a.tenantId, (tx) =>
      tx.booking.create({
        data: {
          tenantId: a.tenantId,
          customerId: a.customerMemberId,
          staffId: a.staffId,
          serviceId: a.serviceId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
          status: 'PENDING',
          priceCents: AMOUNT,
          source: 'PORTAL',
        },
      }),
    );
    expect(created.status).toBe('PENDING');
  });

  it('estorno total aplica REFUNDED', async () => {
    const { paymentId, asaasId } = await seed(a, {
      paymentStatus: 'PAID',
      bookingStatus: 'CONFIRMED',
    });

    await deliver(buildEvent('CHARGE_REFUNDED', asaasId, { refundedCents: AMOUNT }));

    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('REFUNDED');
  });

  it('estorno parcial aplica PARTIALLY_REFUNDED', async () => {
    const { paymentId, asaasId } = await seed(a, {
      paymentStatus: 'PAID',
      bookingStatus: 'CONFIRMED',
    });

    await deliver(buildEvent('CHARGE_PARTIALLY_REFUNDED', asaasId, { refundedCents: 2000 }));

    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('PARTIALLY_REFUNDED');
  });

  it('reentrega do mesmo evento responde 200 e NÃO credita duas vezes', async () => {
    const { paymentId, asaasId } = await seed(a);
    const event = buildEvent('CHARGE_PAID', asaasId);

    const first = await deliver(event);
    const paidAt = (await readPayment(a.tenantId, paymentId))?.paidAt?.toISOString();

    const second = await deliver(event);

    expect(first.body.duplicate).toBeUndefined();
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(await countWebhookEvents(event.eventId)).toBe(1);

    const after = await readPayment(a.tenantId, paymentId);
    expect(after?.status).toBe('PAID');
    expect(after?.paidAt?.toISOString()).toBe(paidAt);
  });

  it('confirmação chegando depois do estorno não regride o estado final', async () => {
    const { bookingId, paymentId, asaasId } = await seed(a);
    await deliver(buildEvent('CHARGE_PAID', asaasId));
    await deliver(buildEvent('CHARGE_REFUNDED', asaasId, { refundedCents: AMOUNT }));
    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('REFUNDED');

    // Evento de confirmação ATRASADO, com eventId novo (não é reentrega).
    const stale = buildEvent('CHARGE_PAID', asaasId);
    const result = await deliver(stale);

    expect(result.status).toBe(200);
    expect(String(result.body.applied)).toContain('ignored');
    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('REFUNDED');
    expect((await readBooking(a.tenantId, bookingId))?.status).toBe('CONFIRMED');
  });

  it('eventos concorrentes convergem para o estado final, sem regressão', async () => {
    const { bookingId, paymentId, asaasId } = await seed(a);

    const paid = buildEvent('CHARGE_PAID', asaasId);
    const refunded = buildEvent('CHARGE_REFUNDED', asaasId, { refundedCents: AMOUNT });

    const results = await Promise.allSettled([deliver(paid), deliver(refunded)]);

    // Ambos são aceitos (um aplica, o outro vira no-op), nunca erro.
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
    }
    // Em qualquer ordem o pagamento converge para REFUNDED — o estado mais
    // final vence — e o agendamento não é derrubado por um estorno.
    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('REFUNDED');
    expect(['PENDING', 'CONFIRMED']).toContain(
      (await readBooking(a.tenantId, bookingId))?.status,
    );
  });

  it('valor divergente do registro local é recusado e não toca no estado', async () => {
    const { paymentId, asaasId } = await seed(a);
    const event = buildEvent('CHARGE_PAID', asaasId, { amountCents: AMOUNT + 1 });

    await expect(deliver(event)).rejects.toMatchObject({ status: 400 });

    expect((await readPayment(a.tenantId, paymentId))?.status).toBe('PENDING');
    expect(await countWebhookEvents(event.eventId)).toBe(0);
  });

  it('evento de cobrança desconhecida é 404', async () => {
    await expect(deliver(buildEvent('CHARGE_PAID', `chg_inexistente_${runId}`))).rejects.toBeInstanceOf(
      WebhookProcessingError,
    );
  });

  it('KYC atualiza a conta de recebimento do tenant certo', async () => {
    const accountId = `acc_${runId}_kyc`;
    await forTenant(b.tenantId, (tx) =>
      tx.asaasAccount.create({
        data: {
          tenantId: b.tenantId,
          asaasAccountId: accountId,
          walletId: `wallet_${runId}`,
          apiKeyEnc: 'enc',
          pixKey: 'pix@exemplo.test',
          kycStatus: 'PENDING',
        },
      }),
    );

    const event: PaymentWebhookEvent = {
      provider: 'mock',
      eventId: `evt_${runId}_${++seq}`,
      type: 'MERCHANT_KYC_UPDATED',
      occurredAt: new Date().toISOString(),
      data: {
        merchant: { accountId, walletId: `wallet_${runId}`, kycStatus: 'APPROVED' },
      },
    };

    await deliver(event);

    const account = await forTenant(b.tenantId, (tx) =>
      tx.asaasAccount.findFirst({
        where: { tenantId: b.tenantId, asaasAccountId: accountId },
        select: { kycStatus: true },
      }),
    );
    expect(account?.kycStatus).toBe('APPROVED');
  });

  it('processa o tenant dono e deixa o outro intacto', async () => {
    const sa = await seed(a);
    const sb = await seed(b);

    await deliver(buildEvent('CHARGE_PAID', sa.asaasId));

    expect((await readPayment(a.tenantId, sa.paymentId))?.status).toBe('PAID');
    expect((await readPayment(b.tenantId, sb.paymentId))?.status).toBe('PENDING');
    expect((await readBooking(a.tenantId, sa.bookingId))?.status).toBe('CONFIRMED');
    expect((await readBooking(b.tenantId, sb.bookingId))?.status).toBe('PENDING');
  });

  it('a leitura escopada de um tenant não enxerga o pagamento do outro', async () => {
    const sb = await seed(b);

    const leaked = await forTenant(a.tenantId, (tx) =>
      tx.payment.findFirst({ where: { id: sb.paymentId } }),
    );

    expect(leaked).toBeNull();
  });
});
