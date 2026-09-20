import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BillingSubscriptionStatus } from './types';

/**
 * Núcleo do webhook de billing (mínimo, sem banco).
 *
 * O Stripe autentica webhooks por HMAC-SHA256 no header `stripe-signature`. O
 * mock usa o mesmo mecanismo para que a rota `/api/webhooks/billing` não tenha
 * de mudar quando o adaptador real entrar na F8.1 — o que muda é quem calcula a
 * assinatura, não como ela é verificada.
 */

export const BILLING_WEBHOOK_TOKEN_HEADER = 'stripe-signature';
export const DEFAULT_BILLING_WEBHOOK_PATH = '/api/webhooks/billing';
export const DEV_BILLING_WEBHOOK_SECRET = 'dev-billing-webhook-secret';

export function getBillingWebhookSecret(): string {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'BILLING_WEBHOOK_SECRET não configurado. Em produção o endpoint de webhook não aceita o valor de desenvolvimento.',
    );
  }
  return DEV_BILLING_WEBHOOK_SECRET;
}

/**
 * Origem da requisição em curso, quando existir — mesma resolução do port de
 * pagamentos. Fora de request scope (testes, cron) cai para as variáveis.
 */
async function requestOrigin(): Promise<string | undefined> {
  try {
    const { headers } = await import('next/headers');
    const headerList = await headers();
    const host = headerList.get('host');
    if (!host) {
      return undefined;
    }
    const protocol =
      headerList.get('x-forwarded-proto') ??
      (process.env.NODE_ENV === 'development' ? 'http' : 'https');
    return `${protocol}://${host}`;
  } catch {
    return undefined;
  }
}

export async function resolveBillingWebhookUrl(): Promise<string> {
  const origin = await requestOrigin();
  if (origin) {
    return new URL(DEFAULT_BILLING_WEBHOOK_PATH, origin).toString();
  }

  const explicit = process.env.BILLING_WEBHOOK_URL;
  if (explicit) {
    return explicit;
  }

  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return new URL(DEFAULT_BILLING_WEBHOOK_PATH, appUrl).toString();
  }

  const port = process.env.PORT;
  if (port) {
    return `http://127.0.0.1:${port}${DEFAULT_BILLING_WEBHOOK_PATH}`;
  }

  throw new Error(
    'URL do webhook de billing não resolvida: sem request atual e sem BILLING_WEBHOOK_URL, APP_URL ou PORT. Configure BILLING_WEBHOOK_URL.',
  );
}

export const BILLING_WEBHOOK_EVENT_TYPES = [
  // Nasce da conclusão do Checkout hospedado: é por este evento, e só por ele,
  // que o `PlatformSub` local passa a existir. Antes do Checkout a assinatura
  // era criada de forma síncrona na chamada do produto; agora ela nasce do
  // lado do provedor, como no B2C do Asaas.
  'SUBSCRIPTION_CREATED',
  'INVOICE_PAID',
  'INVOICE_PAYMENT_FAILED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELED',
] as const;

export type BillingWebhookEventType = (typeof BILLING_WEBHOOK_EVENT_TYPES)[number];

export interface BillingWebhookSubscriptionData {
  id: string;
  customerId: string;
  plan: string;
  status: BillingSubscriptionStatus;
  amountCents: number;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

/**
 * Quem autenticou e traduziu o evento. O mock assina o corpo com o mesmo HMAC
 * que o Stripe, mas o `provider` é o que separa os dois na unique
 * `(provider, eventId)` de `WebhookEvent` — e o que impede um `evt_...` real de
 * colidir com um evento do mock por acaso.
 */
export type BillingWebhookProvider = 'mock' | 'stripe';

export interface BillingWebhookEvent {
  provider: BillingWebhookProvider;
  eventId: string;
  type: BillingWebhookEventType;
  occurredAt: string;
  data: {
    subscription?: BillingWebhookSubscriptionData;
  };
}

export interface WebhookDeliveryRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

export interface WebhookDeliveryResponse {
  ok: boolean;
  status: number;
}

export interface WebhookTransport {
  deliver(request: WebhookDeliveryRequest): Promise<WebhookDeliveryResponse>;
}

export const fetchWebhookTransport: WebhookTransport = {
  async deliver(request) {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return { ok: response.ok, status: response.status };
  },
};

/** Assinatura HMAC-SHA256 (hex) do corpo cru, como o Stripe. */
export function signBillingWebhook(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

export function verifyBillingWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = signBillingWebhook(body, secret);
  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export function buildMockWebhookRequest(
  event: BillingWebhookEvent,
  options: { url: string; secret: string },
): WebhookDeliveryRequest {
  const body = JSON.stringify(event);
  return {
    url: options.url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [BILLING_WEBHOOK_TOKEN_HEADER]: signBillingWebhook(body, options.secret),
    },
    body,
  };
}

export function newBillingEventId(): string {
  return `evt_billing_mock_${randomUUID()}`;
}
