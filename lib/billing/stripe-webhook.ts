import Stripe from 'stripe';
import { toBillingSubscription } from './stripe';
import type { BillingSubscription, BillingSubscriptionStatus } from './types';
import {
  BILLING_WEBHOOK_TOKEN_HEADER,
  type BillingWebhookEvent,
  type BillingWebhookEventType,
  type BillingWebhookSubscriptionData,
} from './webhook';

/**
 * Webhook REAL do Stripe Billing (tarefa F8.1-B).
 *
 * DUAS RESPONSABILIDADES, e só duas:
 *
 *   1. Autenticar. O Stripe assina o CORPO CRU com HMAC-SHA256 e manda
 *      `t=<timestamp>,v1=<hmac>` no header `stripe-signature`. Quem verifica é
 *      `Stripe.webhooks.constructEvent`, que também aplica a tolerância de
 *      timestamp — a defesa contra replay. Não desligue a tolerância.
 *   2. Traduzir. O produto tem os seus próprios cinco tipos de evento
 *      (`BillingWebhookEventType`); este módulo mapeia o vocabulário do Stripe
 *      para eles. Evento que não mapeia devolve `null` — o chamador responde
 *      200 e ignora, porque o Stripe entrega dezenas de tipos e reentrega o que
 *      der erro. Recusar o que não conhecemos faria o provedor retentar para
 *      sempre.
 *
 * NÃO DUPLICA A DERIVAÇÃO. Plano, valor, status e fim de período saem de
 * `toBillingSubscription`, o MESMO caminho que a consulta síncrona usa. Em
 * particular, `current_period_end` vive no ITEM da assinatura, não nela — ler
 * do lugar errado é o bug clássico desta integração.
 *
 * SEM CHAVE NÃO HÁ VERIFICAÇÃO. `constructEvent` só precisa do segredo do
 * webhook; nenhuma chamada de rede acontece. A `STRIPE_SECRET_KEY` só entra se
 * um evento de fatura vier sem a assinatura expandida e for preciso buscá-la —
 * o caminho normal do Stripe em produção.
 */

/** Mesmo nome do header que o mock usa: é o header nativo do Stripe. */
export const STRIPE_SIGNATURE_HEADER = BILLING_WEBHOOK_TOKEN_HEADER;

export class StripeWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookConfigError';
  }
}

export class StripeWebhookTranslationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeWebhookTranslationError';
  }
}

/**
 * Segredo de assinatura do endpoint, devolvido por `stripe listen` (local) ou
 * pelo painel (produção). Sem ele não há como autenticar e a rota falha 500 —
 * erro de servidor, não assinatura inválida: responder 400 mandaria o Stripe
 * reentregar para sempre uma credencial que não existe.
 */
export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new StripeWebhookConfigError(
      'STRIPE_WEBHOOK_SECRET não configurado. O webhook de billing em BILLING_PROVIDER=stripe exige o segredo de assinatura.',
    );
  }
  return secret;
}

/**
 * Verifica a assinatura e devolve o evento. Lança
 * `StripeSignatureVerificationError` para header ausente, assinatura que não
 * bate ou timestamp fora da tolerância (replay), e `SyntaxError` para corpo
 * que não é JSON — o chamador traduz tudo isso em 400.
 */
export function constructStripeWebhookEvent(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): Stripe.Event {
  return Stripe.webhooks.constructEvent(rawBody, signature ?? '', secret);
}

/** Vocabulário do Stripe → vocabulário do produto. */
export const STRIPE_BILLING_EVENT_TYPES: Readonly<Record<string, BillingWebhookEventType>> = {
  'customer.subscription.created': 'SUBSCRIPTION_CREATED',
  'customer.subscription.updated': 'SUBSCRIPTION_UPDATED',
  'customer.subscription.deleted': 'SUBSCRIPTION_CANCELED',
  'invoice.paid': 'INVOICE_PAID',
  'invoice.payment_failed': 'INVOICE_PAYMENT_FAILED',
};

export interface TranslateStripeEventOptions {
  /** Injetável em teste; o padrão busca no Stripe com `STRIPE_SECRET_KEY`. */
  retrieveSubscription?: (subscriptionId: string) => Promise<Stripe.Subscription>;
}

let stripeClient: Stripe | null = null;

function defaultRetrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new StripeWebhookConfigError(
      'STRIPE_SECRET_KEY não configurada: o evento de fatura veio sem a assinatura expandida e não há chave para buscá-la.',
    );
  }
  stripeClient ??= new Stripe(key);
  return stripeClient.subscriptions.retrieve(subscriptionId);
}

/**
 * Traduz um evento do Stripe para o evento interno, ou `null` quando o tipo não
 * mapeia. É assíncrono porque o evento de fatura pode precisar buscar a
 * assinatura; o evento de assinatura carrega o objeto inteiro e não toca a rede.
 */
export async function translateStripeEvent(
  event: Stripe.Event,
  options: TranslateStripeEventOptions = {},
): Promise<BillingWebhookEvent | null> {
  const type = STRIPE_BILLING_EVENT_TYPES[event.type];
  if (!type) {
    return null;
  }

  const reference = subscriptionReferenceOf(event);
  if (!reference) {
    throw new StripeWebhookTranslationError(
      `Evento ${event.id} (${event.type}) mapeia para ${type} mas não trouxe a assinatura.`,
    );
  }

  const subscription =
    typeof reference === 'string'
      ? await (options.retrieveSubscription ?? defaultRetrieveSubscription)(reference)
      : reference;

  let billing: BillingSubscription;
  try {
    billing = toBillingSubscription(subscription);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StripeWebhookTranslationError(
      `Evento ${event.id} (${event.type}) não pôde ser traduzido: ${message}`,
    );
  }

  const data: BillingWebhookSubscriptionData = {
    id: billing.id,
    customerId: billing.customerId,
    plan: billing.plan,
    status: statusForEvent(type, billing.status),
    amountCents: billing.amountCents,
    currentPeriodEnd: billing.currentPeriodEnd,
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
  };

  return {
    provider: 'stripe',
    eventId: event.id,
    type,
    occurredAt: new Date(event.created * 1000).toISOString(),
    data: { subscription: data },
  };
}

/**
 * O evento de assinatura traz o objeto inteiro. O de fatura, no payload padrão,
 * traz só o id — em `parent.subscription_details.subscription`, com o item da
 * linha como alternativa. Quando é id, o chamador busca no Stripe.
 */
function subscriptionReferenceOf(
  event: Stripe.Event,
): Stripe.Subscription | string | null {
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return event.data.object as Stripe.Subscription;
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const fromParent = invoice.parent?.subscription_details?.subscription;
      if (fromParent) return fromParent;
      for (const line of invoice.lines?.data ?? []) {
        if (line.subscription) return line.subscription;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Status do evento vem do tipo, não do status cru da assinatura, porque o
 * Stripe não muda `subscription.status` no mesmo instante em que uma fatura
 * falha. O produto exige coerência entre tipo e status (`incomingStatusForEvent`
 * recusa o contrário), então o tipo é a fonte de verdade aqui.
 */
function statusForEvent(
  type: BillingWebhookEventType,
  stripeStatus: BillingSubscriptionStatus,
): BillingSubscriptionStatus {
  switch (type) {
    case 'INVOICE_PAID':
      return 'ACTIVE';
    case 'INVOICE_PAYMENT_FAILED':
      return 'PAST_DUE';
    case 'SUBSCRIPTION_CANCELED':
      // `customer.subscription.deleted` é cancelamento imediato. O agendado
      // para o fim do período chega como UPDATED com `cancel_at_period_end`.
      return stripeStatus === 'CANCELED' ? 'CANCELED' : stripeStatus;
    default:
      return stripeStatus;
  }
}
