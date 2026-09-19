// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/payments/route';
import type { PaymentWebhookEvent, PaymentWebhookEventType } from '@/lib/payments/webhook';
import { PAYMENTS_WEBHOOK_TOKEN_HEADER } from '@/lib/payments/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * A rota real `/api/webhooks/payments` (F4.0). Prova a ordem do contrato:
 * token ANTES de qualquer coisa, parse, persistência e idempotência, agora
 * contra o banco — não mais contra a projeção em memória da F0.3.
 */

const SECRET = 'route-secret';
const AMOUNT = 5000;
const runId = randomUUID().slice(0, 8);
let seq = 0;

describe('POST /api/webhooks/payments', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'wh-route');
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_${runId}` } } }),
      );
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedPayment(): Promise<{ paymentId: string; asaasId: string }> {
    seq += 1;
    const startsAt = new Date(Date.UTC(2028, 0, 1, 8, 0, 0) + seq * 3_600_000);
    const asaasId = `chg_route_${runId}_${seq}`;
    return forTenant(fixture.tenantId, async (tx) => {
      const booking = await tx.booking.create({
        data: {
          tenantId: fixture.tenantId,
          customerId: fixture.customerMemberId,
          staffId: fixture.staffId,
          serviceId: fixture.serviceId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
          status: 'PENDING',
          priceCents: AMOUNT,
          source: 'PORTAL',
        },
      });
      const payment = await tx.payment.create({
        data: {
          tenantId: fixture.tenantId,
          bookingId: booking.id,
          provider: 'mock',
          method: 'PIX',
          amountCents: AMOUNT,
          status: 'PENDING',
          asaasId,
        },
      });
      return { paymentId: payment.id, asaasId };
    });
  }

  function buildEvent(
    type: PaymentWebhookEventType,
    chargeId: string,
    amountCents = AMOUNT,
  ): PaymentWebhookEvent {
    return {
      provider: 'mock',
      eventId: `evt_${runId}_${++seq}`,
      type,
      occurredAt: new Date().toISOString(),
      data: {
        charge: {
          id: chargeId,
          accountId: 'acc_mock_route',
          status: type === 'CHARGE_PAID' ? 'PAID' : 'PENDING',
          amountCents,
          refundedCents: 0,
        },
      },
    };
  }

  function postWebhook(rawBody: string, token: string = SECRET): Promise<Response> {
    return POST(
      new Request('http://localhost/api/webhooks/payments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [PAYMENTS_WEBHOOK_TOKEN_HEADER]: token,
        },
        body: rawBody,
      }),
    );
  }

  function readPaymentStatus(paymentId: string) {
    return forTenant(fixture.tenantId, (tx) =>
      tx.payment.findFirst({ where: { id: paymentId }, select: { status: true } }),
    );
  }

  it('aceita o evento autenticado e muda o estado no banco', async () => {
    const { paymentId, asaasId } = await seedPayment();
    const event = buildEvent('CHARGE_PAID', asaasId);

    const response = await postWebhook(JSON.stringify(event));

    expect(response.status).toBe(200);
    const body = (await response.json()) as { received: boolean; applied?: string };
    expect(body.received).toBe(true);
    expect(body.applied).toBe(`payment:${paymentId}:PAID`);
    expect((await readPaymentStatus(paymentId))?.status).toBe('PAID');
  });

  it('responde 401 quando o token não confere, sem tocar no estado', async () => {
    const { paymentId, asaasId } = await seedPayment();

    const response = await postWebhook(JSON.stringify(buildEvent('CHARGE_PAID', asaasId)), 'errado');

    expect(response.status).toBe(401);
    expect((await readPaymentStatus(paymentId))?.status).toBe('PENDING');
  });

  it('responde 400 para corpo inválido', async () => {
    const response = await postWebhook('{ "provider": "mock" }');
    expect(response.status).toBe(400);
  });

  it('reentrega do mesmo eventId responde 200 sem duplicar', async () => {
    const { asaasId } = await seedPayment();
    const event = buildEvent('CHARGE_PAID', asaasId);
    const body = JSON.stringify(event);

    const first = await postWebhook(body);
    const repeated = await postWebhook(body);

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    const parsed = (await repeated.json()) as { duplicate?: boolean };
    expect(parsed.duplicate).toBe(true);
    const count = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId: event.eventId } }),
    );
    expect(count).toBe(1);
  });

  it('valor divergente do registro local responde 400', async () => {
    const { paymentId, asaasId } = await seedPayment();
    const event = buildEvent('CHARGE_PAID', asaasId, AMOUNT + 1);

    const response = await postWebhook(JSON.stringify(event));

    expect(response.status).toBe(400);
    expect((await readPaymentStatus(paymentId))?.status).toBe('PENDING');
  });

  it('cobrança desconhecida responde 404 (não engole o evento)', async () => {
    const response = await postWebhook(JSON.stringify(buildEvent('CHARGE_PAID', `chg_missing_${runId}`)));
    expect(response.status).toBe(404);
  });
});
