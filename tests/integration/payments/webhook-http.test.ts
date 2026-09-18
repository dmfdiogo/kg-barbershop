// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore } from '@/lib/payments/mock-store';
import { PAYMENTS_WEBHOOK_TOKEN_HEADER } from '@/lib/payments/webhook';
import { startMockWebhookServer } from '../helpers/mock-webhook-server';

const SECRET = 'http-secret';

async function createApprovedProvider(store: ReturnType<typeof createMockPaymentStore>, url: string) {
  const provider = new MockPaymentProvider({
    store,
    webhookUrl: url,
    webhookSecret: SECRET,
    // sem transport: usa o fetch real. É isto que prova a requisição de verdade.
  });
  const account = await provider.createMerchantAccount({
    name: 'Barbearia Teste',
    document: '12345678909',
  });
  await provider.simulateKycDecision(account.accountId, 'APPROVED');
  return { provider, account };
}

describe('mock disparando webhook por HTTP de verdade', () => {
  beforeEach(() => {
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('entrega o evento autenticado e o handler muda o estado', async () => {
    const store = createMockPaymentStore();
    const server = await startMockWebhookServer(store);

    try {
      const { provider, account } = await createApprovedProvider(store, server.url);
      const charge = await provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      });
      server.requests.length = 0;

      const result = await provider.simulateChargePaid(charge.id);

      expect(result.delivered).toBe(true);
      expect(result.httpStatus).toBe(200);
      expect(server.requests).toHaveLength(1);

      const received = server.requests[0];
      expect(received?.headers[PAYMENTS_WEBHOOK_TOKEN_HEADER]).toBe(SECRET);

      const event = JSON.parse(received?.body ?? '{}') as { type?: string };
      expect(event.type).toBe('CHARGE_PAID');
      expect(store.appCharges.get(charge.id)?.status).toBe('PAID');
    } finally {
      await server.close();
    }
  });

  it('quando o webhook falha, a verdade do provedor muda mas a do app não', async () => {
    const store = createMockPaymentStore();
    const server = await startMockWebhookServer(store, { failWith: 500 });

    try {
      const { provider, account } = await createApprovedProvider(store, server.url);
      const charge = await provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      });

      const result = await provider.simulateChargeRefused(charge.id);

      expect(result.delivered).toBe(false);
      expect(result.httpStatus).toBe(500);
      // O provedor recusou a cobrança...
      expect(store.charges.get(charge.id)?.status).toBe('REFUSED');
      // ...mas a aplicação só saberá quando o webhook chegar.
      expect(store.appCharges.get(charge.id)?.status).toBe('PENDING');
    } finally {
      await server.close();
    }
  });
});
