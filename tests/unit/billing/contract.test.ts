// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MockBillingProvider } from '@/lib/billing/mock';
import { createMockBillingStore } from '@/lib/billing/mock-store';
import { BillingProviderError, type BillingProvider } from '@/lib/billing/types';

/**
 * Suíte de contrato do BillingProvider (contexto-comum.md §5.5).
 *
 * Parametrizada por implementação: hoje só o mock. Na F8.1 o test mode do
 * Stripe entra na mesma lista e é isso que prova que a troca por env não quebra
 * nada. Cada implementação traz seus próprios ganchos de setup (o Stripe tem
 * simulação de faturas, o mock tem os controles equivalentes).
 *
 * O que NÃO existe aqui, de propósito: split, subconta, KYC. O Stripe Billing
 * cobra só a mensalidade do software, na conta única da plataforma (spec §3.1).
 */
interface ProviderFixtureInstance {
  provider: BillingProvider;
  markInvoicePaid(subscriptionId: string): Promise<void>;
  markInvoicePaymentFailed(subscriptionId: string): Promise<void>;
}

interface ProviderFixture {
  name: string;
  setup(): Promise<ProviderFixtureInstance>;
}

const FIXED_NOW = new Date('2026-01-01T12:00:00.000Z');

const fixtures: ProviderFixture[] = [
  {
    name: 'MockBillingProvider',
    async setup() {
      const provider = new MockBillingProvider({
        store: createMockBillingStore(),
        // Nada de rede na suíte de contrato: a entrega do webhook é observada
        // nos testes de integração dedicados.
        transport: { deliver: async () => ({ ok: true, status: 200 }) },
        webhookUrl: 'http://127.0.0.1:9/api/webhooks/billing',
        webhookSecret: 'contract-secret',
        now: () => new Date(FIXED_NOW),
      });
      return {
        provider,
        markInvoicePaid: async (subscriptionId) => {
          await provider.simulateInvoicePaid(subscriptionId);
        },
        markInvoicePaymentFailed: async (subscriptionId) => {
          await provider.simulateInvoicePaymentFailed(subscriptionId);
        },
      };
    },
  },
];

async function captureError(promise: Promise<unknown>): Promise<BillingProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof BillingProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error('Esperava erro do provider, mas a chamada resolveu.');
}

describe.each(fixtures)('BillingProvider: $name', (fixture) => {
  let provider!: BillingProvider;
  let markInvoicePaid!: (subscriptionId: string) => Promise<void>;
  let markInvoicePaymentFailed!: (subscriptionId: string) => Promise<void>;

  async function createCustomer(tenantId = 'tenant_1') {
    return provider.createCustomer({ tenantId, name: 'Barbearia Teste' });
  }

  async function tokenize(customerId: string, number = '4111111111111111') {
    const { token } = await provider.tokenizeCard({
      customerId,
      holderName: 'Dono do Salão',
      number,
      expiryMonth: '12',
      expiryYear: '2030',
      ccv: '123',
    });
    return token;
  }

  beforeEach(async () => {
    ({ provider, markInvoicePaid, markInvoicePaymentFailed } = await fixture.setup());
  });

  it('cria e lê o cliente de cobrança', async () => {
    const customer = await createCustomer();
    expect(customer.id).not.toHaveLength(0);
    expect(customer.tenantId).toBe('tenant_1');

    const stored = await provider.getCustomer(customer.id);
    expect(stored).toEqual(customer);

    const missing = await captureError(provider.getCustomer('cus_inexistente'));
    expect(missing.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('tokeniza cartão válido e recusa número inválido e cartão vencido', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);
    expect(token).not.toHaveLength(0);

    const invalidNumber = await captureError(
      provider.tokenizeCard({
        customerId: customer.id,
        holderName: 'Dono do Salão',
        number: '4111111111111112',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      }),
    );
    expect(invalidNumber.code).toBe('INVALID_CARD');

    const expired = await captureError(
      provider.tokenizeCard({
        customerId: customer.id,
        holderName: 'Dono do Salão',
        number: '4111111111111111',
        expiryMonth: '12',
        expiryYear: '2025',
        ccv: '123',
      }),
    );
    expect(expired.code).toBe('INVALID_CARD');
  });

  it('cria assinatura resolvendo o preço do plano na configuração', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);

    const subscription = await provider.createSubscription({
      customerId: customer.id,
      plan: 'SOLO',
      cardToken: token,
      externalReference: customer.tenantId,
    });

    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.plan).toBe('SOLO');
    expect(subscription.amountCents).toBe(3990);
    expect(subscription.currency).toBe('BRL');
    expect(subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('cria assinatura em trial quando recebe trialEndsAt', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);

    const subscription = await provider.createSubscription({
      customerId: customer.id,
      plan: 'EQUIPE',
      cardToken: token,
      trialEndsAt: '2026-02-01T00:00:00.000Z',
    });

    expect(subscription.status).toBe('TRIALING');
    expect(subscription.amountCents).toBe(7990);
    expect(subscription.currentPeriodEnd).toBe('2026-02-01T00:00:00.000Z');
  });

  it('recusa plano desconhecido e cliente desconhecido', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);

    const unknownPlan = await captureError(
      provider.createSubscription({
        customerId: customer.id,
        // @ts-expect-error: simula payload adulterado vindo de fora do tipo.
        plan: 'ENTERPRISE',
        cardToken: token,
      }),
    );
    expect(unknownPlan.code).toBe('UNKNOWN_PLAN');

    const unknownCustomer = await captureError(
      provider.createSubscription({
        customerId: 'cus_inexistente',
        plan: 'SOLO',
        cardToken: token,
      }),
    );
    expect(unknownCustomer.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('recusa token de cartão de outro cliente', async () => {
    const customerA = await createCustomer('tenant_a');
    const customerB = await createCustomer('tenant_b');
    const tokenA = await tokenize(customerA.id);

    const error = await captureError(
      provider.createSubscription({
        customerId: customerB.id,
        plan: 'SOLO',
        cardToken: tokenA,
      }),
    );
    expect(error.code).toBe('CARD_TOKEN_INVALID');
  });

  it('recusa uma segunda assinatura ativa para o mesmo cliente', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);
    const first = await provider.createSubscription({
      customerId: customer.id,
      plan: 'SOLO',
      cardToken: token,
    });

    const duplicate = await captureError(
      provider.createSubscription({
        customerId: customer.id,
        plan: 'PRO',
        cardToken: token,
      }),
    );
    expect(duplicate.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');

    // Depois de cancelar, uma nova assinatura é permitida.
    await provider.cancelSubscription(first.id);
    const second = await provider.createSubscription({
      customerId: customer.id,
      plan: 'PRO',
      cardToken: token,
    });
    expect(second.plan).toBe('PRO');
    expect(second.status).toBe('ACTIVE');
  });

  it('troca de plano com proração e recusa trocar para o mesmo plano ou após cancelar', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);
    const subscription = await provider.createSubscription({
      customerId: customer.id,
      plan: 'SOLO',
      cardToken: token,
    });

    const upgraded = await provider.changePlan(subscription.id, 'EQUIPE');
    expect(upgraded.plan).toBe('EQUIPE');
    expect(upgraded.amountCents).toBe(7990);

    const same = await captureError(provider.changePlan(subscription.id, 'EQUIPE'));
    expect(same.code).toBe('INVALID_PLAN_CHANGE');

    await provider.cancelSubscription(subscription.id);
    const afterCancel = await captureError(provider.changePlan(subscription.id, 'PRO'));
    expect(afterCancel.code).toBe('SUBSCRIPTION_NOT_ACTIVE');
  });

  it('atualiza o meio de pagamento e recusa token alheio', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);
    const otherCustomer = await createCustomer('tenant_2');
    const otherToken = await tokenize(otherCustomer.id);

    const subscription = await provider.createSubscription({
      customerId: customer.id,
      plan: 'SOLO',
      cardToken: token,
    });

    const updated = await provider.updatePaymentMethod(subscription.id, token);
    expect(updated.id).toBe(subscription.id);

    const foreign = await captureError(
      provider.updatePaymentMethod(subscription.id, otherToken),
    );
    expect(foreign.code).toBe('CARD_TOKEN_INVALID');
  });

  it('cancela na hora e no fim do período, recusando assinatura inexistente', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);

    const immediate = await provider.createSubscription({
      customerId: customer.id,
      plan: 'SOLO',
      cardToken: token,
    });
    const canceled = await provider.cancelSubscription(immediate.id);
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.canceledAt).toBeTruthy();
    const again = await captureError(provider.cancelSubscription(immediate.id));
    expect(again.code).toBe('SUBSCRIPTION_NOT_ACTIVE');

    const customerB = await createCustomer('tenant_b');
    const tokenB = await tokenize(customerB.id);
    const atPeriodEnd = await provider.createSubscription({
      customerId: customerB.id,
      plan: 'EQUIPE',
      cardToken: tokenB,
    });
    const scheduled = await provider.cancelSubscription(atPeriodEnd.id, true);
    expect(scheduled.status).toBe('ACTIVE');
    expect(scheduled.cancelAtPeriodEnd).toBe(true);

    const missing = await captureError(provider.cancelSubscription('sub_inexistente'));
    expect(missing.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('inadimplência marca PAST_DUE e o pagamento reativa e renova o período', async () => {
    const customer = await createCustomer();
    const token = await tokenize(customer.id);
    const subscription = await provider.createSubscription({
      customerId: customer.id,
      plan: 'PRO',
      cardToken: token,
    });
    expect(subscription.currentPeriodEnd).toBe('2026-02-01T12:00:00.000Z');

    await markInvoicePaymentFailed(subscription.id);
    const pastDue = await provider.getSubscription(subscription.id);
    expect(pastDue.status).toBe('PAST_DUE');

    await markInvoicePaid(subscription.id);
    const active = await provider.getSubscription(subscription.id);
    expect(active.status).toBe('ACTIVE');
    expect(active.currentPeriodEnd).toBe('2026-03-01T12:00:00.000Z');
  });
});
