// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore } from '@/lib/payments/mock-store';
import { PaymentProviderError } from '@/lib/payments/types';

function createProvider(): MockPaymentProvider {
  return new MockPaymentProvider({
    store: createMockPaymentStore(),
    transport: { deliver: async () => ({ ok: true, status: 200 }) },
    webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
    webhookSecret: 'payer-ip-secret',
  });
}

async function createApprovedMerchant(provider: MockPaymentProvider): Promise<string> {
  const account = await provider.createMerchantAccount({
    name: 'Barbearia Teste',
    document: '12345678909',
  });
  await provider.simulateKycDecision(account.accountId, 'APPROVED');
  return account.accountId;
}

async function captureError(promise: Promise<unknown>): Promise<PaymentProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error('Esperava erro do provider, mas a chamada resolveu.');
}

/**
 * Em desenvolvimento a requisição chega de loopback. `DEV_PAYER_IP` permite
 * exercer o fluxo sem afrouxar o guard: fora de development a variável é
 * ignorada e o loopback continua recusado.
 */
describe('DEV_PAYER_IP', () => {
  beforeEach(() => {
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', 'payer-ip-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('em desenvolvimento, aceita loopback trocando pela origem configurada', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PAYER_IP', '8.8.8.8');

    const provider = createProvider();
    const accountId = await createApprovedMerchant(provider);
    const { token } = await provider.tokenizeCard({
      accountId,
      customerId: 'customer_1',
      number: '4111111111111111',
      holderName: 'Cliente Teste',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
      remoteIp: '127.0.0.1',
    });
    const charge = await provider.createCharge({
      accountId,
      customerId: 'customer_1',
      method: 'CARD',
      amountCents: 5000,
      dueDate: '2030-01-15',
      cardToken: token,
      remoteIp: '127.0.0.1',
    });

    expect(charge.status).toBe('PENDING');
  });

  it('sem DEV_PAYER_IP, desenvolvimento continua recusando loopback', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PAYER_IP', undefined);

    const provider = createProvider();
    const accountId = await createApprovedMerchant(provider);
    const error = await captureError(
      provider.tokenizeCard({
        accountId,
        customerId: 'customer_1',
        number: '4111111111111111',
        holderName: 'Cliente Teste',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
        remoteIp: '127.0.0.1',
      }),
    );

    expect(error.code).toBe('REMOTE_IP_NOT_PUBLIC');
  });

  it('em produção a variável é ignorada e o loopback é recusado', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_PAYER_IP', '8.8.8.8');

    const provider = createProvider();
    const accountId = await createApprovedMerchant(provider);
    const error = await captureError(
      provider.tokenizeCard({
        accountId,
        customerId: 'customer_1',
        number: '4111111111111111',
        holderName: 'Cliente Teste',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
        remoteIp: '127.0.0.1',
      }),
    );

    expect(error.code).toBe('REMOTE_IP_NOT_PUBLIC');
  });
});
