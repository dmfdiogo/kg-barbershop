// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/payments/route';
import { MockPaymentProvider, resetMockPaymentProvider } from '@/lib/payments/mock';
import { resetMockPaymentStore, snapshotMockPaymentStore } from '@/lib/payments/mock-store';
import {
  PAYMENTS_WEBHOOK_TOKEN_HEADER,
  type WebhookDeliveryRequest,
} from '@/lib/payments/webhook';

const SECRET = 'route-secret';

let deliveries: WebhookDeliveryRequest[];

beforeEach(() => {
  vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
  resetMockPaymentStore();
  resetMockPaymentProvider();
  deliveries = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function globalProvider(): MockPaymentProvider {
  return new MockPaymentProvider({
    transport: {
      async deliver(request) {
        deliveries.push(request);
        return { ok: true, status: 200 };
      },
    },
    webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
  });
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

async function createPaidCharge(provider: MockPaymentProvider) {
  const account = await provider.createMerchantAccount({
    name: 'Barbearia Teste',
    document: '12345678909',
  });
  await provider.simulateKycDecision(account.accountId, 'APPROVED');
  const charge = await provider.createCharge({
    accountId: account.accountId,
    customerId: 'customer_1',
    method: 'PIX',
    amountCents: 5000,
    dueDate: '2030-01-15',
  });
  await provider.simulateChargePaid(charge.id);
  return charge;
}

describe('POST /api/webhooks/payments', () => {
  it('aceita o evento do mock e muda o estado da aplicação', async () => {
    const charge = await createPaidCharge(globalProvider());
    const delivery = deliveries.at(-1);
    expect(delivery).toBeDefined();

    const response = await postWebhook(delivery?.body ?? '');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { received: boolean; applied?: string };
    expect(body.received).toBe(true);
    expect(body.applied).toBe(`charge:${charge.id}:PAID`);
    expect(snapshotMockPaymentStore().appCharges[0]?.status).toBe('PAID');
  });

  it('responde 401 quando o token não confere', async () => {
    await createPaidCharge(globalProvider());
    const delivery = deliveries.at(-1);

    const response = await postWebhook(delivery?.body ?? '', 'token-errado');

    expect(response.status).toBe(401);
    expect(snapshotMockPaymentStore().appCharges[0]?.status).toBe('PENDING');
  });

  it('responde 400 para corpo inválido', async () => {
    const response = await postWebhook('{ "provider": "mock" }');
    expect(response.status).toBe(400);
  });

  it('reentrega do mesmo eventId responde 200 sem duplicar', async () => {
    await createPaidCharge(globalProvider());
    const delivery = deliveries.at(-1);

    await postWebhook(delivery?.body ?? '');
    const repeated = await postWebhook(delivery?.body ?? '');

    expect(repeated.status).toBe(200);
    const body = (await repeated.json()) as { duplicate?: boolean };
    expect(body.duplicate).toBe(true);
    expect(snapshotMockPaymentStore().appliedWebhookEventCount).toBe(1);
  });
});
