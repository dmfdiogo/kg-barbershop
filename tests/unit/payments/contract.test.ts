// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore } from '@/lib/payments/mock-store';
import { PaymentProviderError, type PaymentProvider } from '@/lib/payments/types';

/**
 * Suíte de contrato do PaymentProvider (contexto-comum.md §5.4).
 *
 * Parametrizada por implementação: hoje só o mock. Na F8.2 o sandbox do Asaas
 * entra na mesma lista e é isso que prova que a troca por env não quebra nada.
 * Cada implementação traz seus próprios ganchos de setup (o sandbox real tem
 * KYC e pagamento fora do port, o mock tem os controles de simulação).
 */
interface ProviderFixtureInstance {
  provider: PaymentProvider;
  approveKyc(accountId: string): Promise<void>;
  markChargePaid(chargeId: string): Promise<void>;
}

interface ProviderFixture {
  name: string;
  setup(): Promise<ProviderFixtureInstance>;
}

const fixtures: ProviderFixture[] = [
  {
    name: 'MockPaymentProvider',
    async setup() {
      const provider = new MockPaymentProvider({
        store: createMockPaymentStore(),
        // Nada de rede na suíte de contrato: a entrega do webhook é observada
        // nos testes de integração dedicados.
        transport: { deliver: async () => ({ ok: true, status: 200 }) },
        webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
        webhookSecret: 'contract-secret',
      });
      return {
        provider,
        approveKyc: async (accountId) => {
          await provider.simulateKycDecision(accountId, 'APPROVED');
        },
        markChargePaid: async (chargeId) => {
          await provider.simulateChargePaid(chargeId);
        },
      };
    },
  },
];

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

describe.each(fixtures)('PaymentProvider: $name', (fixture) => {
  let provider!: PaymentProvider;
  let approveKyc!: (accountId: string) => Promise<void>;
  let markChargePaid!: (chargeId: string) => Promise<void>;

  async function createApprovedMerchant() {
    const account = await provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '12345678909',
    });
    await approveKyc(account.accountId);
    return account;
  }

  async function tokenize(accountId: string, customerId: string): Promise<string> {
    const { token } = await provider.tokenizeCard({
      accountId,
      customerId,
      number: '4111111111111111',
      holderName: 'Cliente Teste',
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
      remoteIp: '8.8.8.8',
    });
    return token;
  }

  beforeEach(async () => {
    ({ provider, approveKyc, markChargePaid } = await fixture.setup());
  });

  it('cria conta de recebimento com KYC pendente', async () => {
    const account = await provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '123.456.789-09',
    });

    expect(account.accountId).not.toHaveLength(0);
    expect(account.walletId).not.toHaveLength(0);
    expect(account.kycStatus).toBe('PENDING');

    const stored = await provider.getMerchantAccount(account.accountId);
    expect(stored.accountId).toBe(account.accountId);
    expect(stored.kycStatus).toBe('PENDING');

    const balance = await provider.getBalance(account.accountId);
    expect(balance).toEqual({ availableCents: 0, pendingCents: 0 });
  });

  it('recusa cobrança em subconta com KYC não aprovado', async () => {
    const account = await provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '12345678909',
    });

    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      }),
    );
    expect(error.code).toBe('KYC_NOT_APPROVED');
  });

  it('cria cobrança Pix que nasce PENDING (nunca paga de forma síncrona)', async () => {
    const account = await createApprovedMerchant();
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
    });

    expect(charge.status).toBe('PENDING');
    expect(charge.amountCents).toBe(5000);
    expect(charge.refundedCents).toBe(0);
    expect(charge.pixCopyPaste).toBeTruthy();
    expect(charge.paidAt).toBeUndefined();
  });

  it('recusa valor com casas decimais em centavos', async () => {
    const account = await createApprovedMerchant();
    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 10.5,
        dueDate: '2030-01-15',
      }),
    );
    expect(error.code).toBe('INVALID_AMOUNT');
  });

  it('recusa split apontando para a carteira de quem cria a cobrança', async () => {
    const account = await createApprovedMerchant();
    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
        split: [{ walletId: account.walletId, percentageValue: 10 }],
      }),
    );
    expect(error.code).toBe('SPLIT_TO_SELF');
  });

  it('aceita split para outra carteira e recusa split acima do valor', async () => {
    const account = await createApprovedMerchant();
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
      split: [{ walletId: 'wallet_plataforma', fixedValueCents: 500 }],
    });
    expect(charge.split).toEqual([
      { walletId: 'wallet_plataforma', fixedValueCents: 500 },
    ]);

    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
        split: [{ walletId: 'wallet_plataforma', fixedValueCents: 6000 }],
      }),
    );
    expect(error.code).toBe('INVALID_SPLIT');
  });

  it('recusa cobrança de cartão sem remoteIp', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');

    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_1',
        method: 'CARD',
        amountCents: 5000,
        dueDate: '2030-01-15',
        cardToken: token,
      }),
    );
    expect(error.code).toBe('REMOTE_IP_REQUIRED');
  });

  it('recusa remoteIp privado, loopback ou de servidor', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');

    for (const remoteIp of ['127.0.0.1', '10.0.0.10', '192.168.0.10', '::1']) {
      const error = await captureError(
        provider.createCharge({
          accountId: account.accountId,
          customerId: 'customer_1',
          method: 'CARD',
          amountCents: 5000,
          dueDate: '2030-01-15',
          cardToken: token,
          remoteIp,
        }),
      );
      expect(error.code).toBe('REMOTE_IP_NOT_PUBLIC');
    }
  });

  it('aceita cartão com token do próprio cliente e IP público', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'CARD',
      amountCents: 5000,
      dueDate: '2030-01-15',
      cardToken: token,
      remoteIp: '8.8.8.8',
    });

    expect(charge.status).toBe('PENDING');
    expect(charge.cardLast4).toBe('1111');
  });

  it('recusa token de cartão de outro cliente', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');

    const error = await captureError(
      provider.createCharge({
        accountId: account.accountId,
        customerId: 'customer_2',
        method: 'CARD',
        amountCents: 5000,
        dueDate: '2030-01-15',
        cardToken: token,
        remoteIp: '8.8.8.8',
      }),
    );
    expect(error.code).toBe('CARD_TOKEN_INVALID');
  });

  it('recusa número de cartão inválido na tokenização', async () => {
    const account = await createApprovedMerchant();
    const error = await captureError(
      provider.tokenizeCard({
        accountId: account.accountId,
        customerId: 'customer_1',
        number: '4111111111111112',
        holderName: 'Cliente Teste',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
        remoteIp: '8.8.8.8',
      }),
    );
    expect(error.code).toBe('INVALID_CARD');
  });

  it('recusa estorno de cobrança não paga', async () => {
    const account = await createApprovedMerchant();
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
    });

    const error = await captureError(provider.refund(charge.id, 5000));
    expect(error.code).toBe('INVALID_CHARGE_STATE');
  });

  it('estorna total e parcialmente, recusando acima do saldo', async () => {
    const account = await createApprovedMerchant();
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
    });
    await markChargePaid(charge.id);

    const partial = await provider.refund(charge.id, 2000);
    expect(partial.status).toBe('DONE');
    expect(partial.amountCents).toBe(2000);

    const excessive = await captureError(provider.refund(charge.id, 4000));
    expect(excessive.code).toBe('REFUND_EXCEEDS_AMOUNT');

    const total = await provider.refund(charge.id, 3000);
    expect(total.amountCents).toBe(3000);
  });

  it('recusa cobrança de conta desconhecida', async () => {
    const error = await captureError(
      provider.createCharge({
        accountId: 'acc_inexistente',
        customerId: 'customer_1',
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-15',
      }),
    );
    expect(error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('cria assinatura com cartão na subconta e cancela', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');

    const subscription = await provider.createSubscription({
      accountId: account.accountId,
      customerId: 'customer_1',
      planId: 'plan_1',
      amountCents: 9900,
      cycle: 'MONTHLY',
      nextDueDate: '2030-02-01',
      cardToken: token,
      remoteIp: '8.8.8.8',
      split: [{ walletId: 'wallet_plataforma', percentageValue: 5 }],
    });

    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.split).toEqual([
      { walletId: 'wallet_plataforma', percentageValue: 5 },
    ]);

    await provider.cancelSubscription(subscription.id);
    const canceled = await captureError(provider.cancelSubscription(subscription.id));
    expect(canceled.code).toBe('SUBSCRIPTION_NOT_ACTIVE');

    const missing = await captureError(provider.cancelSubscription('sub_inexistente'));
    expect(missing.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('recusa assinatura sem remoteIp do pagador', async () => {
    const account = await createApprovedMerchant();
    const token = await tokenize(account.accountId, 'customer_1');

    const error = await captureError(
      provider.createSubscription({
        accountId: account.accountId,
        customerId: 'customer_1',
        planId: 'plan_1',
        amountCents: 9900,
        cycle: 'MONTHLY',
        nextDueDate: '2030-02-01',
        cardToken: token,
        remoteIp: '',
      }),
    );
    expect(error.code).toBe('REMOTE_IP_REQUIRED');
  });
});

describe('MockPaymentProvider: contabilidade do mock', () => {
  it('getBalance separa pendente e disponível conforme os webhooks chegam', async () => {
    const provider = new MockPaymentProvider({
      store: createMockPaymentStore(),
      transport: { deliver: async () => ({ ok: true, status: 200 }) },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: 'contract-secret',
    });
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

    expect(await provider.getBalance(account.accountId)).toEqual({
      availableCents: 0,
      pendingCents: 5000,
    });

    await provider.simulateChargePaid(charge.id);
    expect(await provider.getBalance(account.accountId)).toEqual({
      availableCents: 5000,
      pendingCents: 0,
    });

    await provider.refund(charge.id, 2000);
    expect(await provider.getBalance(account.accountId)).toEqual({
      availableCents: 3000,
      pendingCents: 0,
    });
  });
});
