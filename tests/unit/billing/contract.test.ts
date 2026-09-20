// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { MockBillingProvider } from '@/lib/billing/mock';
import { createMockBillingStore } from '@/lib/billing/mock-store';
import { StripeBillingProvider } from '@/lib/billing/stripe';
import {
  BillingProviderError,
  type BillingProvider,
  type BillingSubscription,
} from '@/lib/billing/types';

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
 *
 * E nada de cartão. A captura acontece na página hospedada do provedor; o
 * contrato daqui vai até a URL da sessão, e retoma quando o webhook conta que
 * a assinatura nasceu. Concluir o pagamento é um GANCHO da fixture, porque
 * cada implementação simula isso do seu jeito — o mock tem
 * `completeCheckoutSession`, o test mode do Stripe tem o helper dele.
 */
interface ProviderFixtureInstance {
  provider: BillingProvider;
  /**
   * O mock simula fatura paga e recusada; no test mode do Stripe isso exige
   * test clocks, que é escopo de outra rodada. O teste correspondente é
   * pulado em vez de fingir que passou.
   */
  supportsInvoiceSimulation: boolean;
  /** Simula o dono pagando na página hospedada. Devolve a assinatura criada. */
  completeCheckout(sessionId: string): Promise<BillingSubscription>;
  markInvoicePaid(subscriptionId: string): Promise<void>;
  markInvoicePaymentFailed(subscriptionId: string): Promise<void>;
}

interface ProviderFixture {
  name: string;
  setup(): Promise<ProviderFixtureInstance>;
}

const FIXED_NOW = new Date('2026-01-01T12:00:00.000Z');

// O provider real fala com a rede; 5s (padrão do vitest) não dá.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

/**
 * Trial calculado a partir do relógio REAL, não de uma data fixa. O mock roda
 * com relógio injetado e aceitaria qualquer data futura em relação a ele; o
 * Stripe usa o relógio de verdade e recusa trial no passado. Data fixa no
 * arquivo funcionava em janeiro e quebrava em setembro.
 */
const TRIAL_ENDS_AT = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

/**
 * A implementação real entra na MESMA suíte, e é isso que prova que trocar de
 * provider por variável de ambiente não muda o comportamento do produto.
 *
 * Roda só quando `STRIPE_SECRET_KEY` está no AMBIENTE — não basta estar no
 * `.env`, que este teste não carrega. Assim `npm test` e o CI seguem sem rede
 * e sem segredo, e a verificação contra o test mode é um comando explícito:
 *
 *   STRIPE_SECRET_KEY=sk_test_... npx vitest run tests/unit/billing/contract.test.ts
 *
 * `completeCheckout` não "clica" na página hospedada — isso não tem API. Ele
 * reproduz o ESTADO FINAL que o checkout produz: meio de pagamento de teste no
 * cliente e assinatura criada com o mesmo preço e o mesmo trial que a sessão
 * pediu. O trial vem do metadata da sessão, porque o Stripe não devolve o
 * `subscription_data` que foi enviado.
 */
const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();

const stripeFixture: ProviderFixture[] = stripeKey?.startsWith('sk_test_')
  ? [
      {
        name: 'StripeBillingProvider (test mode)',
        async setup() {
          const stripe = new Stripe(stripeKey);
          const provider = new StripeBillingProvider({ client: stripe });
          return {
            provider,
            supportsInvoiceSimulation: false,
            completeCheckout: async (sessionId) => {
              const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['line_items'],
              });
              const customerId = session.customer as string;
              const priceId = session.line_items?.data?.[0]?.price?.id;
              if (!priceId) throw new Error('sessão sem preço');

              const pm = await stripe.paymentMethods.attach('pm_card_visa', {
                customer: customerId,
              });
              await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: pm.id },
              });

              const trialEnd = session.metadata?.trial_end;
              const created = await stripe.subscriptions.create({
                customer: customerId,
                items: [{ price: priceId }],
                ...(trialEnd ? { trial_end: Number(trialEnd) } : {}),
                metadata: session.metadata ?? {},
              });
              return provider.getSubscription(created.id);
            },
            markInvoicePaid: async () => {
              throw new Error('não aplicável ao test mode nesta rodada');
            },
            markInvoicePaymentFailed: async () => {
              throw new Error('não aplicável ao test mode nesta rodada');
            },
          };
        },
      },
    ]
  : [];

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
        supportsInvoiceSimulation: true,
        completeCheckout: async (sessionId) => {
          const { subscription } = await provider.completeCheckoutSession(sessionId);
          return subscription;
        },
        markInvoicePaid: async (subscriptionId) => {
          await provider.simulateInvoicePaid(subscriptionId);
        },
        markInvoicePaymentFailed: async (subscriptionId) => {
          await provider.simulateInvoicePaymentFailed(subscriptionId);
        },
      };
    },
  },
  ...stripeFixture,
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
  let completeCheckout!: (sessionId: string) => Promise<BillingSubscription>;
  let supportsInvoices = true;
  let markInvoicePaid!: (subscriptionId: string) => Promise<void>;
  let markInvoicePaymentFailed!: (subscriptionId: string) => Promise<void>;

  const SUCCESS_URL = 'https://app.exemplo.com.br/painel/assinatura?ok=1';
  const CANCEL_URL = 'https://app.exemplo.com.br/painel/assinatura?cancelado=1';

  async function createCustomer(tenantId = 'tenant_1') {
    return provider.createCustomer({ tenantId, name: 'Barbearia Teste' });
  }

  /** Percorre o fluxo inteiro: abre a sessão e conclui o pagamento. */
  async function subscribeVia(
    customerId: string,
    plan: 'SOLO' | 'EQUIPE' | 'PRO',
    trialEndsAt?: string,
  ): Promise<BillingSubscription> {
    const session = await provider.createCheckoutSession({
      customerId,
      plan,
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      ...(trialEndsAt ? { trialEndsAt } : {}),
    });
    return completeCheckout(session.id);
  }

  beforeEach(async () => {
    const instance = await fixture.setup();
    ({ provider, completeCheckout, markInvoicePaid, markInvoicePaymentFailed } = instance);
    supportsInvoices = instance.supportsInvoiceSimulation;
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

  it('abre a sessão hospedada sem criar assinatura, e só o webhook a cria', async () => {
    const customer = await createCustomer();
    const session = await provider.createCheckoutSession({
      customerId: customer.id,
      plan: 'SOLO',
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      externalReference: customer.tenantId,
    });

    expect(session.url).toMatch(/^https?:\/\//);
    expect(session.id).not.toHaveLength(0);
    // A validade é do provedor (24h no Stripe), não do nosso relógio: o
    // contrato só promete uma data ISO utilizável.
    expect(Number.isNaN(new Date(session.expiresAt).getTime())).toBe(false);

    // O ponto do desenho: abrir a sessão NÃO assina ninguém.
    const beforePaying = await captureError(provider.getSubscription(session.id));
    expect(beforePaying.code).toBe('SUBSCRIPTION_NOT_FOUND');

    const subscription = await completeCheckout(session.id);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.plan).toBe('SOLO');
    expect(subscription.amountCents).toBe(3990);
    expect(subscription.currency).toBe('BRL');
    expect(subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('a sessão nasce em trial quando recebe trialEndsAt', async () => {
    const customer = await createCustomer();
    const subscription = await subscribeVia(customer.id, 'EQUIPE', TRIAL_ENDS_AT);

    expect(subscription.status).toBe('TRIALING');
    expect(subscription.amountCents).toBe(7990);
    // O provedor arredonda para o segundo; comparar o instante, não a string.
    expect(Math.abs(Date.parse(subscription.currentPeriodEnd) - Date.parse(TRIAL_ENDS_AT))).
      toBeLessThan(1000);
  });

  it('recusa plano desconhecido, cliente desconhecido e URL de retorno relativa', async () => {
    const customer = await createCustomer();

    const unknownPlan = await captureError(
      provider.createCheckoutSession({
        customerId: customer.id,
        // @ts-expect-error: simula payload adulterado vindo de fora do tipo.
        plan: 'ENTERPRISE',
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      }),
    );
    expect(unknownPlan.code).toBe('UNKNOWN_PLAN');

    const unknownCustomer = await captureError(
      provider.createCheckoutSession({
        customerId: 'cus_inexistente',
        plan: 'SOLO',
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      }),
    );
    expect(unknownCustomer.code).toBe('CUSTOMER_NOT_FOUND');

    // URL relativa não serve: quem redireciona é o provedor, de outro domínio.
    const relative = await captureError(
      provider.createCheckoutSession({
        customerId: customer.id,
        plan: 'SOLO',
        successUrl: '/painel/assinatura',
        cancelUrl: CANCEL_URL,
      }),
    );
    expect(relative.code).toBe('VALIDATION');
  });

  it('recusa abrir sessão para quem já tem assinatura ativa', async () => {
    const customer = await createCustomer();
    const first = await subscribeVia(customer.id, 'SOLO');

    const duplicate = await captureError(
      provider.createCheckoutSession({
        customerId: customer.id,
        plan: 'PRO',
        successUrl: SUCCESS_URL,
        cancelUrl: CANCEL_URL,
      }),
    );
    expect(duplicate.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');

    // Depois de cancelar, assinar de novo é permitido.
    await provider.cancelSubscription(first.id);
    const second = await subscribeVia(customer.id, 'PRO');
    expect(second.plan).toBe('PRO');
    expect(second.status).toBe('ACTIVE');
  });

  it('o portal do cliente devolve URL absoluta e recusa cliente desconhecido', async () => {
    const customer = await createCustomer();
    const portal = await provider.createPortalSession({
      customerId: customer.id,
      returnUrl: SUCCESS_URL,
    });
    expect(portal.url).toMatch(/^https?:\/\//);

    const missing = await captureError(
      provider.createPortalSession({ customerId: 'cus_inexistente', returnUrl: SUCCESS_URL }),
    );
    expect(missing.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('troca de plano com proração e recusa trocar para o mesmo plano ou após cancelar', async () => {
    const customer = await createCustomer();
    const subscription = await subscribeVia(customer.id, 'SOLO');

    const upgraded = await provider.changePlan(subscription.id, 'EQUIPE');
    expect(upgraded.plan).toBe('EQUIPE');
    expect(upgraded.amountCents).toBe(7990);

    const same = await captureError(provider.changePlan(subscription.id, 'EQUIPE'));
    expect(same.code).toBe('INVALID_PLAN_CHANGE');

    await provider.cancelSubscription(subscription.id);
    const afterCancel = await captureError(provider.changePlan(subscription.id, 'PRO'));
    expect(afterCancel.code).toBe('SUBSCRIPTION_NOT_ACTIVE');
  });

  it('cancela na hora e no fim do período, recusando assinatura inexistente', async () => {
    const customer = await createCustomer();
    const immediate = await subscribeVia(customer.id, 'SOLO');
    const canceled = await provider.cancelSubscription(immediate.id);
    expect(canceled.status).toBe('CANCELED');
    expect(canceled.canceledAt).toBeTruthy();
    const again = await captureError(provider.cancelSubscription(immediate.id));
    expect(again.code).toBe('SUBSCRIPTION_NOT_ACTIVE');

    const customerB = await createCustomer('tenant_b');
    const atPeriodEnd = await subscribeVia(customerB.id, 'EQUIPE');
    const scheduled = await provider.cancelSubscription(atPeriodEnd.id, true);
    expect(scheduled.status).toBe('ACTIVE');
    expect(scheduled.cancelAtPeriodEnd).toBe(true);

    const missing = await captureError(provider.cancelSubscription('sub_inexistente'));
    expect(missing.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('inadimplência marca PAST_DUE e o pagamento reativa e renova o período', async (ctx) => {
    if (!supportsInvoices) ctx.skip();
    const customer = await createCustomer();
    const subscription = await subscribeVia(customer.id, 'PRO');
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
