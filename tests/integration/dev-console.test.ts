// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as confirmCharge } from '@/app/dev/api/payments/charge/confirm/route';
import { POST as expireCharge } from '@/app/dev/api/payments/charge/expire/route';
import { getMockPaymentProvider, resetMockPaymentProvider } from '@/lib/payments/mock';
import {
  getMockPaymentStore,
  resetMockPaymentStore,
  snapshotMockPaymentStore,
} from '@/lib/payments/mock-store';
import type { MockPaymentProvider } from '@/lib/payments/mock';
import { startMockWebhookServer } from './helpers/mock-webhook-server';

const SECRET = 'dev-console-secret';

function formRequest(url: string, fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request(url, { method: 'POST', body: form });
}

async function seedApprovedMerchant(provider: MockPaymentProvider): Promise<string> {
  const account = await provider.createMerchantAccount({
    name: 'Barbearia Teste',
    document: '12345678909',
  });
  await provider.simulateKycDecision(account.accountId, 'APPROVED');
  return account.accountId;
}

describe('console /dev', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
    resetMockPaymentStore();
    resetMockPaymentProvider();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bloqueia as actions fora de desenvolvimento (404 no servidor)', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await confirmCharge(
      formRequest('http://localhost/dev/api/payments/charge/confirm', { chargeId: 'x' }),
    );

    expect(response.status).toBe(404);
  });

  it('o botão Confirmar pagamento dispara webhook e muda o estado', async () => {
    const store = getMockPaymentStore();
    const server = await startMockWebhookServer(store);
    vi.stubEnv('PAYMENTS_WEBHOOK_URL', server.url);

    try {
      const provider = getMockPaymentProvider();
      const accountId = await seedApprovedMerchant(provider);
      const charge = await provider.createCharge({
        accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      });
      expect(store.appCharges.get(charge.id)?.status).toBe('PENDING');

      const response = await confirmCharge(
        formRequest('http://localhost/dev/api/payments/charge/confirm', {
          chargeId: charge.id,
        }),
      );

      expect(response.status).toBe(303);
      const location = response.headers.get('location') ?? '';
      expect(location).toContain('event=CHARGE_PAID');
      expect(location).toContain('delivered=true');
      expect(store.appCharges.get(charge.id)?.status).toBe('PAID');
    } finally {
      await server.close();
    }
  });

  it('o botão Expirar Pix muda o estado via webhook', async () => {
    const store = getMockPaymentStore();
    const server = await startMockWebhookServer(store);
    vi.stubEnv('PAYMENTS_WEBHOOK_URL', server.url);

    try {
      const provider = getMockPaymentProvider();
      const accountId = await seedApprovedMerchant(provider);
      const charge = await provider.createCharge({
        accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      });

      const response = await expireCharge(
        formRequest('http://localhost/dev/api/payments/charge/expire', {
          chargeId: charge.id,
        }),
      );

      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toContain('event=CHARGE_EXPIRED');
      expect(store.appCharges.get(charge.id)?.status).toBe('EXPIRED');
    } finally {
      await server.close();
    }
  });

  it('action devolve o erro de validação em vez de mudar estado', async () => {
    const response = await confirmCharge(
      formRequest('http://localhost/dev/api/payments/charge/confirm', {
        chargeId: 'chg_mock_inexistente',
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('error=');
    expect(snapshotMockPaymentStore().appCharges).toHaveLength(0);
  });
});
