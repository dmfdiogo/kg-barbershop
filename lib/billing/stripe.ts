import Stripe from 'stripe';
import { BILLING_PLANS, isBillingPlanCode, type BillingPlanCode } from './plans';
import {
  BillingProviderError,
  type BillingCustomer,
  type BillingProvider,
  type BillingSubscription,
  type BillingSubscriptionStatus,
  type HostedSession,
  type NewBillingCustomer,
  type NewCheckoutSession,
  type NewPortalSession,
} from './types';

/**
 * Adaptador real do `BillingProvider` contra o Stripe Billing (tarefa F8.1).
 *
 * Mora em `lib/billing/` e não em `lib/payments/` como a fase previa: o Stripe
 * implementa o port de BILLING (mensalidade do software, conta única da
 * plataforma), enquanto `lib/payments/` é o port de PAGAMENTO B2C do Asaas,
 * com subconta, KYC e split. Misturar os dois diretórios foi o que gerou o
 * `tokenizeCard` recebendo PAN neste port — um contrato copiado do vizinho
 * errado.
 *
 * O CARTÃO NUNCA PASSA POR AQUI. A captura é no Checkout hospedado; este
 * módulo só cria a sessão e lê o que o Stripe devolve.
 *
 * NENHUM CÓDIGO DE PRODUTO IMPORTA ESTE ARQUIVO — só a factory de `./index.ts`,
 * escolhida por `BILLING_PROVIDER`. É o que torna o rollback para mock uma
 * variável de ambiente.
 *
 * O PREÇO NUNCA VEM DO CHAMADOR. A sessão de checkout é montada a partir do
 * `lookup_key` do preço criado por `scripts/stripe-setup.mts`, que por sua vez
 * sai de `lib/billing/plans.ts`. Aceitar valor de quem chama permitiria assinar
 * o plano Pro por R$ 1,00.
 */

/** Mesma convenção do script de catálogo; mudar aqui exige mudar lá. */
function lookupKeyFor(code: BillingPlanCode): string {
  return `bom_horario_${code.toLowerCase()}_mensal`;
}

/**
 * `current_period_end` MIGROU para o item da assinatura na API
 * `2026-08-26.dahlia`; no objeto `Subscription` ele não existe mais. Ler do
 * item é o caminho atual, e o fallback cobre contas ainda fixadas numa versão
 * antiga da API.
 */
function periodEndOf(subscription: Stripe.Subscription): Date {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const seconds = item?.current_period_end ?? legacy;
  if (!seconds) {
    throw new BillingProviderError(
      'VALIDATION',
      `Assinatura ${subscription.id} veio sem fim de período.`,
    );
  }
  return new Date(seconds * 1000);
}

function statusOf(subscription: Stripe.Subscription): BillingSubscriptionStatus {
  switch (subscription.status) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    // `incomplete` é cobrança inicial não concluída; `unpaid` é inadimplência
    // depois de esgotadas as retentativas. Para o produto os dois significam a
    // mesma coisa: há assinatura e ela não está paga.
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    case 'canceled':
    case 'incomplete_expired':
      return 'CANCELED';
    default:
      return 'PAST_DUE';
  }
}

/** Plano a partir do preço, pela `lookup_key` e, em último caso, pela metadata. */
function planOf(subscription: Stripe.Subscription): BillingPlanCode {
  const price = subscription.items?.data?.[0]?.price;
  const fromMetadata = price?.metadata?.plan_code;
  if (fromMetadata && isBillingPlanCode(fromMetadata)) return fromMetadata;

  const lookup = price?.lookup_key ?? '';
  for (const code of Object.keys(BILLING_PLANS) as BillingPlanCode[]) {
    if (lookup === lookupKeyFor(code)) return code;
  }
  throw new BillingProviderError(
    'UNKNOWN_PLAN',
    `Assinatura ${subscription.id} aponta para um preço fora do catálogo (${lookup || 'sem lookup_key'}).`,
  );
}

function amountOf(subscription: Stripe.Subscription): number {
  const amount = subscription.items?.data?.[0]?.price?.unit_amount;
  if (typeof amount !== 'number') {
    throw new BillingProviderError('VALIDATION', `Assinatura ${subscription.id} sem valor.`);
  }
  return amount;
}

/**
 * Exportada para o tradutor de webhook (`./stripe-webhook`) reusar a MESMA
 * derivação de plano, valor, status e fim de período. Duplicar isto faria o
 * webhook e a consulta síncrona discordarem sobre o que a assinatura é.
 *
 * Cuidado com a armadilha: `current_period_end` mora no ITEM, não na assinatura.
 */
export function toBillingSubscription(subscription: Stripe.Subscription): BillingSubscription {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;

  const currency = subscription.currency?.toUpperCase();
  if (currency !== 'BRL') {
    throw new BillingProviderError(
      'VALIDATION',
      `Assinatura ${subscription.id} em ${currency}; o produto cobra apenas em BRL.`,
    );
  }

  return {
    id: subscription.id,
    customerId,
    plan: planOf(subscription),
    amountCents: amountOf(subscription),
    currency: 'BRL',
    status: statusOf(subscription),
    currentPeriodEnd: periodEndOf(subscription).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    createdAt: new Date(subscription.created * 1000).toISOString(),
    ...(subscription.trial_end
      ? { trialEndsAt: new Date(subscription.trial_end * 1000).toISOString() }
      : {}),
    ...(subscription.metadata?.tenant_id
      ? { externalReference: subscription.metadata.tenant_id }
      : {}),
    ...(subscription.canceled_at
      ? { canceledAt: new Date(subscription.canceled_at * 1000).toISOString() }
      : {}),
  };
}

function toCustomer(customer: Stripe.Customer): BillingCustomer {
  return {
    id: customer.id,
    tenantId: customer.metadata?.tenant_id ?? '',
    name: customer.name ?? '',
    createdAt: new Date(customer.created * 1000).toISOString(),
    ...(customer.email ? { email: customer.email } : {}),
  };
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    (error.code === 'resource_missing' || error.statusCode === 404)
  );
}

export interface StripeBillingProviderOptions {
  apiKey?: string;
  /** Injetável em teste. */
  client?: Stripe;
}

/** Mesma marca que `scripts/stripe-setup.mts` grava; mudar aqui exige mudar lá. */
const PORTAL_MANAGED_BY = 'bom-horario/stripe-setup';

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;
  private portalConfigCache: string | null = null;

  constructor(options: StripeBillingProviderOptions = {}) {
    if (options.client) {
      this.stripe = options.client;
      return;
    }
    const apiKey = options.apiKey ?? process.env.STRIPE_SECRET_KEY?.trim();
    if (!apiKey) {
      throw new Error('STRIPE_SECRET_KEY não definida; BILLING_PROVIDER=stripe exige a chave.');
    }
    this.stripe = new Stripe(apiKey);
  }

  async createCustomer(input: NewBillingCustomer): Promise<BillingCustomer> {
    if (!input.tenantId) {
      throw new BillingProviderError('VALIDATION', 'tenantId é obrigatório.');
    }
    const customer = await this.stripe.customers.create({
      name: input.name,
      ...(input.email ? { email: input.email } : {}),
      // O tenant vai em metadata, nunca no e-mail: e-mail muda, tenant não.
      metadata: {
        tenant_id: input.tenantId,
        ...(input.document ? { document: input.document } : {}),
      },
    });
    return toCustomer(customer);
  }

  async getCustomer(customerId: string): Promise<BillingCustomer> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) {
        throw new BillingProviderError(
          'CUSTOMER_NOT_FOUND',
          `Cliente ${customerId} foi removido no provedor.`,
        );
      }
      return toCustomer(customer);
    } catch (error) {
      if (isMissing(error)) {
        throw new BillingProviderError('CUSTOMER_NOT_FOUND', `Cliente não encontrado: ${customerId}`);
      }
      throw error;
    }
  }

  /** Preço ativo do plano, resolvido pela `lookup_key` do catálogo versionado. */
  private async priceFor(plan: BillingPlanCode): Promise<Stripe.Price> {
    if (!isBillingPlanCode(plan)) {
      throw new BillingProviderError('UNKNOWN_PLAN', `Plano desconhecido: ${String(plan)}`);
    }
    const found = await this.stripe.prices.list({
      lookup_keys: [lookupKeyFor(plan)],
      active: true,
      limit: 1,
    });
    const price = found.data[0];
    if (!price) {
      throw new BillingProviderError(
        'UNKNOWN_PLAN',
        `Preço do plano ${plan} não existe nesta conta. Rode scripts/stripe-setup.mts.`,
      );
    }
    return price;
  }

  /** Assinatura viva do cliente, se houver. Cancelada não conta. */
  private async activeSubscriptionOf(customerId: string): Promise<Stripe.Subscription | null> {
    const list = await this.stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    });
    return (
      list.data.find(
        (subscription) =>
          subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired',
      ) ?? null
    );
  }

  async createCheckoutSession(input: NewCheckoutSession): Promise<HostedSession> {
    const customer = await this.getCustomer(input.customerId);
    const price = await this.priceFor(input.plan);

    for (const url of [input.successUrl, input.cancelUrl]) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('proto');
      } catch {
        throw new BillingProviderError('VALIDATION', `URL de retorno inválida: ${url}`);
      }
    }

    // O Stripe aceitaria uma segunda assinatura para o mesmo cliente; o produto
    // não. Recusar ANTES de abrir a sessão evita o dono digitar cartão à toa.
    if (await this.activeSubscriptionOf(customer.id)) {
      throw new BillingProviderError(
        'SUBSCRIPTION_ALREADY_EXISTS',
        `Cliente ${customer.id} já possui assinatura ativa.`,
      );
    }

    let trialEnd: number | undefined;
    if (input.trialEndsAt) {
      const when = new Date(input.trialEndsAt);
      if (Number.isNaN(when.getTime())) {
        throw new BillingProviderError('VALIDATION', 'trialEndsAt não é data válida.');
      }
      if (when.getTime() <= Date.now()) {
        throw new BillingProviderError('VALIDATION', 'trialEndsAt deve estar no futuro.');
      }
      trialEnd = Math.floor(when.getTime() / 1000);
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: price.id, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      subscription_data: {
        ...(trialEnd ? { trial_end: trialEnd } : {}),
        metadata: {
          plan_code: input.plan,
          ...(input.externalReference ? { tenant_id: input.externalReference } : {}),
        },
      },
      ...(input.externalReference ? { client_reference_id: input.externalReference } : {}),
      // A sessão não devolve `subscription_data` de volta, então o que foi
      // PEDIDO fica registrado aqui. Serve para reconciliar a volta do
      // checkout — e é o que permite a um teste de contrato reproduzir a
      // conclusão do pagamento com os mesmos parâmetros.
      metadata: {
        plan_code: input.plan,
        ...(trialEnd ? { trial_end: String(trialEnd) } : {}),
        ...(input.externalReference ? { tenant_id: input.externalReference } : {}),
      },
    });

    if (!session.url) {
      throw new BillingProviderError('VALIDATION', 'Stripe não devolveu URL para a sessão.');
    }

    return {
      id: session.id,
      url: session.url,
      expiresAt: new Date((session.expires_at ?? Math.floor(Date.now() / 1000) + 86400) * 1000)
        .toISOString(),
    };
  }

  /**
   * Id da NOSSA configuração de portal, achada pela metadata do script de
   * setup e memoizada por processo.
   *
   * Apontar a configuração explicitamente não é preciosismo: a conta tem uma
   * configuração DEFAULT que o Stripe cria sozinho, e nela cancelamento vem
   * LIGADO. Abrir a sessão sem dizer qual usar cairia nessa, e o dono poderia
   * cancelar — ou, se um dia o default mudar no painel, trocar de plano — sem
   * passar pela regra de downgrade do produto. Depender do default seria
   * depender de um estado que qualquer pessoa muda no dashboard.
   */
  private async portalConfigurationId(): Promise<string> {
    if (this.portalConfigCache) return this.portalConfigCache;
    const list = await this.stripe.billingPortal.configurations.list({ limit: 100 });
    const ours = list.data.find((c) => c.metadata?.managed_by === PORTAL_MANAGED_BY);
    if (!ours) {
      throw new BillingProviderError(
        'VALIDATION',
        'Configuração de portal do projeto não existe nesta conta. Rode scripts/stripe-setup.mts.',
      );
    }
    this.portalConfigCache = ours.id;
    return ours.id;
  }

  async createPortalSession(input: NewPortalSession): Promise<HostedSession> {
    const customer = await this.getCustomer(input.customerId);
    try {
      new URL(input.returnUrl);
    } catch {
      throw new BillingProviderError('VALIDATION', `returnUrl inválida: ${input.returnUrl}`);
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: input.returnUrl,
      configuration: await this.portalConfigurationId(),
    });
    return {
      id: session.id,
      url: session.url,
      // O portal não devolve expiração; a sessão vale enquanto o link não é
      // usado. Declaramos 24h para o contrato ter sempre uma data utilizável.
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return toBillingSubscription(subscription);
    } catch (error) {
      if (isMissing(error)) {
        throw new BillingProviderError(
          'SUBSCRIPTION_NOT_FOUND',
          `Assinatura não encontrada: ${subscriptionId}`,
        );
      }
      throw error;
    }
  }

  async changePlan(
    subscriptionId: string,
    nextPlan: BillingPlanCode,
  ): Promise<BillingSubscription> {
    const price = await this.priceFor(nextPlan);
    const current = await this.retrieveActive(subscriptionId);

    if (planOf(current) === nextPlan) {
      throw new BillingProviderError(
        'INVALID_PLAN_CHANGE',
        `Assinatura já está no plano ${nextPlan}.`,
      );
    }

    const item = current.items.data[0];
    if (!item) {
      throw new BillingProviderError('VALIDATION', `Assinatura ${subscriptionId} sem item.`);
    }

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: item.id, price: price.id }],
      // Proração é o provedor que calcula — é o motivo de a troca de plano
      // continuar passando por aqui em vez de virar UPDATE local.
      proration_behavior: 'create_prorations',
    });
    return toBillingSubscription(updated);
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd = false,
  ): Promise<BillingSubscription> {
    const current = await this.retrieveActive(subscriptionId);

    const updated = atPeriodEnd
      ? await this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true })
      : await this.stripe.subscriptions.cancel(current.id);

    return toBillingSubscription(updated);
  }

  /** Retrieve que traduz ausência e recusa assinatura já cancelada. */
  private async retrieveActive(subscriptionId: string): Promise<Stripe.Subscription> {
    let subscription: Stripe.Subscription;
    try {
      subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    } catch (error) {
      if (isMissing(error)) {
        throw new BillingProviderError(
          'SUBSCRIPTION_NOT_FOUND',
          `Assinatura não encontrada: ${subscriptionId}`,
        );
      }
      throw error;
    }
    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      throw new BillingProviderError(
        'SUBSCRIPTION_NOT_ACTIVE',
        `Assinatura ${subscriptionId} está cancelada.`,
      );
    }
    return subscription;
  }
}

let cached: StripeBillingProvider | null = null;

export function getStripeBillingProvider(): StripeBillingProvider {
  cached ??= new StripeBillingProvider();
  return cached;
}

/** Só para teste: descarta o cliente memoizado. */
export function resetStripeBillingProvider(): void {
  cached = null;
}
