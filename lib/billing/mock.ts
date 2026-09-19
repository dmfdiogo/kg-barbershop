import { randomUUID } from 'node:crypto';
import {
  BILLING_PLANS,
  isBillingPlanCode,
  type BillingPlanCode,
} from './plans';
import {
  appendBillingWebhookDelivery,
  copy,
  getMockBillingStore,
  nextMockBillingId,
  type BillingCheckoutSessionRecord,
  type BillingWebhookDeliveryLogEntry,
  type MockBillingStore,
} from './mock-store';
import {
  buildMockWebhookRequest,
  fetchWebhookTransport,
  getBillingWebhookSecret,
  newBillingEventId,
  resolveBillingWebhookUrl,
  type BillingWebhookEvent,
  type BillingWebhookEventType,
  type BillingWebhookSubscriptionData,
  type WebhookTransport,
} from './webhook';
import {
  BillingProviderError,
  type BillingCustomer,
  type BillingProvider,
  type BillingSubscription,
  type HostedSession,
  type NewBillingCustomer,
  type NewCheckoutSession,
  type NewPortalSession,
} from './types';

/** Validade da URL hospedada. O Stripe usa 24h para Checkout Session. */
const CHECKOUT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Base da URL do console de simulação. Em produção o mock não roda; aqui o
 * valor só precisa formar uma URL absoluta, como a do provedor de verdade.
 */
function mockConsoleBase(): string {
  return process.env.APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
}

function requireAbsoluteUrl(value: string, field: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BillingProviderError('VALIDATION', `${field} precisa ser uma URL absoluta.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BillingProviderError('VALIDATION', `${field} precisa ser http ou https.`);
  }
}

export interface MockBillingSimulationResult {
  eventId: string;
  delivered: boolean;
  httpStatus?: number;
  error?: string;
}

export interface MockBillingProviderOptions {
  /** Store isolado (testes); o padrão é o store global compartilhado com /dev. */
  store?: MockBillingStore;
  transport?: WebhookTransport;
  /** Sobrescreve `BILLING_WEBHOOK_URL`/`resolveBillingWebhookUrl()`. */
  webhookUrl?: string;
  /** Sobrescreve `BILLING_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  now?: () => Date;
}

/**
 * Mock do provedor de billing (Stripe Billing na F8.1), usado de F7 a F7.
 *
 * Não é um stub permissivo: recusa plano desconhecido, cartão sem Luhn, cartão
 * vencido, token de cartão de outro cliente, segunda assinatura ativa para o
 * mesmo cliente, troca para o mesmo plano — as mesmas regras que o Stripe
 * reprova. E não "paga" nada de forma síncrona: a simulação dispara um webhook
 * HTTP na rota da aplicação (`contexto-comum.md` §5.2), para que a máquina de
 * estados seja a mesma do provedor real.
 *
 * O valor da assinatura é SEMPRE resolvido de `plans.ts`, nunca do chamador:
 * preço é configuração, e deixar o cliente escolher o valor seria furar o
 * catálogo. Não há split nem subconta — o Stripe cobra só a mensalidade do
 * software, na conta única da plataforma.
 */
export class MockBillingProvider implements BillingProvider {
  private readonly store: MockBillingStore;
  private readonly transport: WebhookTransport;
  private readonly webhookUrlOption: string | undefined;
  private readonly webhookSecretOption: string | undefined;
  private readonly now: () => Date;

  constructor(options: MockBillingProviderOptions = {}) {
    this.store = options.store ?? getMockBillingStore();
    this.transport = options.transport ?? fetchWebhookTransport;
    this.webhookUrlOption = options.webhookUrl;
    this.webhookSecretOption = options.webhookSecret;
    this.now = options.now ?? (() => new Date());
  }

  async createCustomer(input: NewBillingCustomer): Promise<BillingCustomer> {
    if (!input.tenantId.trim()) {
      throw new BillingProviderError('VALIDATION', 'tenantId é obrigatório.');
    }
    if (input.name.trim().length < 2) {
      throw new BillingProviderError('VALIDATION', 'Nome do estabelecimento é obrigatório.');
    }
    if (input.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      throw new BillingProviderError('VALIDATION', `E-mail inválido: ${input.email}`);
    }

    const customer: BillingCustomer = {
      id: nextMockBillingId(this.store, 'cus_mock'),
      tenantId: input.tenantId,
      name: input.name.trim(),
      createdAt: this.now().toISOString(),
      ...(input.email ? { email: input.email } : {}),
    };
    this.store.customers.set(customer.id, customer);
    return copy(customer);
  }

  async getCustomer(customerId: string): Promise<BillingCustomer> {
    return copy(this.requireCustomer(customerId));
  }

  /**
   * Abre a sessão hospedada. NÃO cria assinatura: devolve uma URL e espera.
   *
   * A URL aponta para `/dev/billing`, onde se conclui ou abandona o pagamento —
   * é o equivalente de billing ao `/dev/payments` do B2C. Concluir dispara
   * `SUBSCRIPTION_CREATED` de verdade contra a própria aplicação, que é o
   * caminho que a produção vai percorrer.
   */
  async createCheckoutSession(input: NewCheckoutSession): Promise<HostedSession> {
    this.requireCustomer(input.customerId);
    if (!isBillingPlanCode(input.plan)) {
      throw new BillingProviderError('UNKNOWN_PLAN', `Plano desconhecido: ${String(input.plan)}`);
    }
    requireAbsoluteUrl(input.successUrl, 'successUrl');
    requireAbsoluteUrl(input.cancelUrl, 'cancelUrl');

    if (input.trialEndsAt !== undefined) {
      requireDate(input.trialEndsAt, 'trialEndsAt');
      if (new Date(input.trialEndsAt).getTime() <= this.now().getTime()) {
        throw new BillingProviderError('VALIDATION', 'trialEndsAt deve estar no futuro.');
      }
    }

    // O Stripe recusa uma segunda assinatura ativa para o mesmo cliente; o mock
    // recusa já na abertura da sessão, para o dono não digitar cartão à toa.
    for (const subscription of this.store.subscriptions.values()) {
      if (subscription.customerId === input.customerId && subscription.status !== 'CANCELED') {
        throw new BillingProviderError(
          'SUBSCRIPTION_ALREADY_EXISTS',
          `Cliente ${input.customerId} já possui assinatura ativa.`,
        );
      }
    }

    const id = nextMockBillingId(this.store, 'cs_billing_mock');
    const createdAt = this.now();
    const record: BillingCheckoutSessionRecord = {
      id,
      customerId: input.customerId,
      plan: input.plan,
      status: 'PENDING',
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + CHECKOUT_TTL_MS).toISOString(),
      ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
      ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    };
    this.store.checkoutSessions.set(id, record);

    return { id, url: `${mockConsoleBase()}/dev/billing?sessao=${id}`, expiresAt: record.expiresAt };
  }

  /**
   * Portal do cliente. No Stripe é onde o dono troca cartão e baixa fatura; no
   * mock é a mesma tela de `/dev/billing`, filtrada pelo cliente.
   */
  async createPortalSession(input: NewPortalSession): Promise<HostedSession> {
    this.requireCustomer(input.customerId);
    requireAbsoluteUrl(input.returnUrl, 'returnUrl');
    const expiresAt = new Date(this.now().getTime() + CHECKOUT_TTL_MS).toISOString();
    return {
      id: nextMockBillingId(this.store, 'bps_billing_mock'),
      url: `${mockConsoleBase()}/dev/billing?cliente=${input.customerId}`,
      expiresAt,
    };
  }

  /**
   * Conclui o pagamento da sessão — o que o dono faria na página do provedor.
   * É aqui que a assinatura passa a existir, e o `SUBSCRIPTION_CREATED` sai.
   * Idempotente: concluir de novo não cria uma segunda assinatura.
   */
  async completeCheckoutSession(
    sessionId: string,
  ): Promise<{ subscription: BillingSubscription; delivery: MockBillingSimulationResult }> {
    const session = this.store.checkoutSessions.get(sessionId);
    if (!session) {
      throw new BillingProviderError('VALIDATION', `Sessão não encontrada: ${sessionId}`);
    }
    if (session.status === 'COMPLETED') {
      throw new BillingProviderError('VALIDATION', 'Sessão já concluída.');
    }
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) {
      session.status = 'EXPIRED';
      throw new BillingProviderError('VALIDATION', 'Sessão expirada; abra outra.');
    }
    if (!isBillingPlanCode(session.plan)) {
      throw new BillingProviderError('UNKNOWN_PLAN', `Plano desconhecido: ${session.plan}`);
    }

    const plan = BILLING_PLANS[session.plan];
    const subscription: BillingSubscription = {
      id: nextMockBillingId(this.store, 'sub_billing_mock'),
      customerId: session.customerId,
      plan: session.plan,
      amountCents: plan.priceCents,
      currency: 'BRL',
      status: session.trialEndsAt ? 'TRIALING' : 'ACTIVE',
      currentPeriodEnd: session.trialEndsAt ?? addMonths(this.now(), 1).toISOString(),
      cancelAtPeriodEnd: false,
      createdAt: this.now().toISOString(),
      ...(session.trialEndsAt ? { trialEndsAt: session.trialEndsAt } : {}),
      ...(session.externalReference ? { externalReference: session.externalReference } : {}),
    };
    this.store.subscriptions.set(subscription.id, subscription);
    session.status = 'COMPLETED';

    const delivery = await this.deliverEvent('SUBSCRIPTION_CREATED', { subscription });
    return { subscription: copy(subscription), delivery };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription> {
    return copy(this.requireSubscription(subscriptionId));
  }

  async changePlan(
    subscriptionId: string,
    nextPlan: BillingPlanCode,
  ): Promise<BillingSubscription> {
    const subscription = this.requireActiveSubscription(subscriptionId);
    if (!isBillingPlanCode(nextPlan)) {
      throw new BillingProviderError('UNKNOWN_PLAN', `Plano desconhecido: ${String(nextPlan)}`);
    }
    if (subscription.plan === nextPlan) {
      throw new BillingProviderError(
        'INVALID_PLAN_CHANGE',
        `Assinatura já está no plano ${nextPlan}.`,
      );
    }

    subscription.plan = nextPlan;
    subscription.amountCents = BILLING_PLANS[nextPlan].priceCents;
    await this.deliverEvent('SUBSCRIPTION_UPDATED', { subscription });
    return copy(subscription);
  }

  async cancelSubscription(
    subscriptionId: string,
    atPeriodEnd = false,
  ): Promise<BillingSubscription> {
    const subscription = this.store.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new BillingProviderError(
        'SUBSCRIPTION_NOT_FOUND',
        `Assinatura não encontrada: ${subscriptionId}`,
      );
    }
    if (subscription.status === 'CANCELED') {
      throw new BillingProviderError('SUBSCRIPTION_NOT_ACTIVE', 'Assinatura já está cancelada.');
    }

    if (atPeriodEnd) {
      subscription.cancelAtPeriodEnd = true;
    } else {
      subscription.status = 'CANCELED';
      subscription.cancelAtPeriodEnd = false;
      subscription.canceledAt = this.now().toISOString();
    }

    await this.deliverEvent('SUBSCRIPTION_CANCELED', { subscription });
    return copy(subscription);
  }

  /**
   * Controles do console /dev — simulam a decisão do provedor e disparam o
   * webhook. O `PlatformSub` do lado da aplicação só muda quando ele chega.
   */
  async simulateInvoicePaid(subscriptionId: string): Promise<MockBillingSimulationResult> {
    const subscription = this.requireActiveSubscription(subscriptionId);
    subscription.status = 'ACTIVE';
    subscription.cancelAtPeriodEnd = false;
    subscription.currentPeriodEnd = addMonths(
      new Date(subscription.currentPeriodEnd),
      1,
    ).toISOString();
    delete subscription.trialEndsAt;
    return this.deliverEvent('INVOICE_PAID', { subscription });
  }

  async simulateInvoicePaymentFailed(
    subscriptionId: string,
  ): Promise<MockBillingSimulationResult> {
    const subscription = this.requireActiveSubscription(subscriptionId);
    subscription.status = 'PAST_DUE';
    return this.deliverEvent('INVOICE_PAYMENT_FAILED', { subscription });
  }

  private async deliverEvent(
    type: BillingWebhookEventType,
    data: { subscription: BillingSubscription },
  ): Promise<MockBillingSimulationResult> {
    const event: BillingWebhookEvent = {
      provider: 'mock',
      eventId: newBillingEventId(),
      type,
      occurredAt: this.now().toISOString(),
      data: { subscription: subscriptionWebhookData(data.subscription) },
    };

    let delivered = false;
    let httpStatus: number | undefined;
    let error: string | undefined;
    let url = this.webhookUrlOption ?? '';

    try {
      url = this.webhookUrlOption ?? (await resolveBillingWebhookUrl());
      const secret = this.webhookSecretOption ?? getBillingWebhookSecret();
      const request = buildMockWebhookRequest(event, { url, secret });
      const response = await this.transport.deliver(request);
      delivered = response.ok;
      httpStatus = response.status;
      if (!response.ok) {
        error = `webhook respondeu ${response.status}`;
      }
    } catch (cause) {
      error = errorMessage(cause);
    }

    const entry: BillingWebhookDeliveryLogEntry = {
      id: randomUUID(),
      eventId: event.eventId,
      type,
      url,
      delivered,
      at: event.occurredAt,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(error ? { error } : {}),
    };
    appendBillingWebhookDelivery(this.store, entry);

    return {
      eventId: event.eventId,
      delivered,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(error ? { error } : {}),
    };
  }

  private requireCustomer(customerId: string): BillingCustomer {
    const customer = this.store.customers.get(customerId);
    if (!customer) {
      throw new BillingProviderError(
        'CUSTOMER_NOT_FOUND',
        `Cliente não encontrado: ${customerId}`,
      );
    }
    return customer;
  }

  private requireSubscription(subscriptionId: string): BillingSubscription {
    const subscription = this.store.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new BillingProviderError(
        'SUBSCRIPTION_NOT_FOUND',
        `Assinatura não encontrada: ${subscriptionId}`,
      );
    }
    return subscription;
  }

  private requireActiveSubscription(subscriptionId: string): BillingSubscription {
    const subscription = this.requireSubscription(subscriptionId);
    if (subscription.status === 'CANCELED') {
      throw new BillingProviderError(
        'SUBSCRIPTION_NOT_ACTIVE',
        `Assinatura ${subscriptionId} está cancelada.`,
      );
    }
    return subscription;
  }

}

function subscriptionWebhookData(
  subscription: BillingSubscription,
): BillingWebhookSubscriptionData {
  return {
    id: subscription.id,
    customerId: subscription.customerId,
    plan: subscription.plan,
    status: subscription.status,
    amountCents: subscription.amountCents,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function requireDate(value: string, field: string): void {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new BillingProviderError('VALIDATION', `${field} não é uma data válida.`);
  }
}


function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let singleton: MockBillingProvider | undefined;

/** Instância compartilhada pelo código de produto e pelo console /dev. */
export function getMockBillingProvider(): MockBillingProvider {
  singleton ??= new MockBillingProvider();
  return singleton;
}

export function resetMockBillingProvider(): void {
  singleton = undefined;
}
