// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore, type MockPaymentStore } from '@/lib/payments/mock-store';
import {
  handlePaymentWebhook,
  PAYMENTS_WEBHOOK_TOKEN_HEADER,
  type WebhookDeliveryRequest,
} from '@/lib/payments/webhook';

const SECRET = 'handler-secret';

interface Env {
  provider: MockPaymentProvider;
  store: MockPaymentStore;
  deliveries: WebhookDeliveryRequest[];
}

function createEnv(): Env {
  const deliveries: WebhookDeliveryRequest[] = [];
  const store = createMockPaymentStore();
  const provider = new MockPaymentProvider({
    store,
    transport: {
      async deliver(request) {
        deliveries.push(request);
        return { ok: true, status: 200 };
      },
    },
    webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
    webhookSecret: SECRET,
  });
  return { provider, store, deliveries };
}

function lastDelivery(env: Env): WebhookDeliveryRequest {
  const delivery = env.deliveries.at(-1);
  if (!delivery) {
    throw new Error('Nenhuma entrega de webhook foi registrada.');
  }
  return delivery;
}

function handle(env: Env, delivery: WebhookDeliveryRequest, token = SECRET) {
  return handlePaymentWebhook(
    {
      rawBody: delivery.body,
      headers: { [PAYMENTS_WEBHOOK_TOKEN_HEADER]: token },
    },
    env.store,
  );
}

async function createCharge(env: Env, method: 'PIX' | 'CARD' = 'PIX') {
  const account = await env.provider.createMerchantAccount({
    name: 'Barbearia Teste',
    document: '12345678909',
  });
  await env.provider.simulateKycDecision(account.accountId, 'APPROVED');

  const input = {
    accountId: account.accountId,
    customerId: 'customer_1',
    method,
    amountCents: 5000,
    dueDate: '2030-01-15',
  } as const;

  return env.provider.createCharge(
    method === 'CARD'
      ? {
          ...input,
          cardToken: await tokenize(env, account.accountId),
          remoteIp: '8.8.8.8',
        }
      : input,
  );
}

async function tokenize(env: Env, accountId: string): Promise<string> {
  const { token } = await env.provider.tokenizeCard({
    accountId,
    customerId: 'customer_1',
    number: '4111111111111111',
    holderName: 'Cliente Teste',
    expiryMonth: '12',
    expiryYear: '2030',
    ccv: '123',
    remoteIp: '8.8.8.8',
  });
  return token;
}

describe('handlePaymentWebhook', () => {
  let env!: Env;

  beforeEach(() => {
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
    env = createEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('aplica CHARGE_PAID na projeção do app', async () => {
    const charge = await createCharge(env);
    await env.provider.simulateChargePaid(charge.id);

    const result = await handle(env, lastDelivery(env));

    expect(result.status).toBe(200);
    expect(result.body.applied).toBe(`charge:${charge.id}:PAID`);
    const appCharge = env.store.appCharges.get(charge.id);
    expect(appCharge?.status).toBe('PAID');
    expect(appCharge?.paidAt).toBeTruthy();
    expect(env.store.charges.get(charge.id)?.status).toBe('PAID');
  });

  it('evento repetido responde 200 sem reprocessar', async () => {
    const charge = await createCharge(env);
    await env.provider.simulateChargePaid(charge.id);
    const delivery = lastDelivery(env);

    await handle(env, delivery);
    const repeated = await handle(env, delivery);

    expect(repeated.status).toBe(200);
    expect(repeated.body.duplicate).toBe(true);
    expect(env.store.appliedWebhookEvents.size).toBe(1);
  });

  it('recusa token inválido antes de tocar no estado', async () => {
    const charge = await createCharge(env);
    await env.provider.simulateChargePaid(charge.id);

    const result = await handle(env, lastDelivery(env), 'token-errado');

    expect(result.status).toBe(401);
    expect(env.store.appCharges.get(charge.id)?.status).toBe('PENDING');
  });

  it('recusa corpo que não é JSON', async () => {
    const result = await handlePaymentWebhook(
      { rawBody: 'não é json', headers: { [PAYMENTS_WEBHOOK_TOKEN_HEADER]: SECRET } },
      env.store,
    );
    expect(result.status).toBe(400);
  });

  it('recusa payload sem eventId', async () => {
    const result = await handlePaymentWebhook(
      {
        rawBody: JSON.stringify({ provider: 'mock', type: 'CHARGE_PAID', occurredAt: 'x', data: {} }),
        headers: { [PAYMENTS_WEBHOOK_TOKEN_HEADER]: SECRET },
      },
      env.store,
    );
    expect(result.status).toBe(400);
  });

  it('confronta o valor do payload com o registro local e libera a reentrega', async () => {
    const charge = await createCharge(env);
    await env.provider.simulateChargePaid(charge.id);
    const delivery = lastDelivery(env);

    const tampered = JSON.parse(delivery.body) as {
      data: { charge: { amountCents: number } };
    };
    tampered.data.charge.amountCents += 1;

    const rejected = await handlePaymentWebhook(
      {
        rawBody: JSON.stringify(tampered),
        headers: { [PAYMENTS_WEBHOOK_TOKEN_HEADER]: SECRET },
      },
      env.store,
    );
    expect(rejected.status).toBe(400);
    expect(env.store.appCharges.get(charge.id)?.status).toBe('PENDING');
    expect(env.store.appliedWebhookEvents.size).toBe(0);

    const applied = await handle(env, delivery);
    expect(applied.status).toBe(200);
    expect(env.store.appCharges.get(charge.id)?.status).toBe('PAID');
  });

  it('aplica a decisão de KYC na projeção do app', async () => {
    const account = await env.provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '12345678909',
    });
    await env.provider.simulateKycDecision(account.accountId, 'APPROVED');

    const result = await handle(env, lastDelivery(env));

    expect(result.body.applied).toBe(`merchant:${account.accountId}:APPROVED`);
    expect(env.store.appMerchants.get(account.accountId)?.kycStatus).toBe('APPROVED');
  });

  it('aplica recusa e expiração de Pix', async () => {
    const refusedCharge = await createCharge(env);
    await env.provider.simulateChargeRefused(refusedCharge.id);
    await handle(env, lastDelivery(env));
    expect(env.store.appCharges.get(refusedCharge.id)?.status).toBe('REFUSED');

    const expiredCharge = await createCharge(env);
    await env.provider.simulatePixExpired(expiredCharge.id);
    await handle(env, lastDelivery(env));
    expect(env.store.appCharges.get(expiredCharge.id)?.status).toBe('EXPIRED');
  });

  it('aplica estorno parcial com o valor estornado do registro local', async () => {
    const charge = await createCharge(env);
    await env.provider.simulateChargePaid(charge.id);
    await env.provider.refund(charge.id, 2000);

    const result = await handle(env, lastDelivery(env));

    expect(result.body.applied).toBe(`charge:${charge.id}:PARTIALLY_REFUNDED`);
    const appCharge = env.store.appCharges.get(charge.id);
    expect(appCharge?.status).toBe('PARTIALLY_REFUNDED');
    expect(appCharge?.refundedCents).toBe(2000);
  });
});
