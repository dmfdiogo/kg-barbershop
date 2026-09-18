import { timingSafeEqual } from 'node:crypto';
import { getMockPaymentStore, type MockPaymentStore } from './mock-store';
import type { ChargeStatus, KycStatus } from './types';

/**
 * Núcleo do webhook de pagamentos (mínimo, sem banco).
 *
 * A F0.2 (schema/Prisma) está rodando em paralelo e ainda não foi mesclada, por
 * isso a idempotência vive no store do mock (dedupe por `provider:eventId`),
 * não em `WebhookEvent`. A F4.0 assume a rota e troca isto por persistência,
 * transação e máquina de estados — ver comentário em
 * `app/api/webhooks/payments/route.ts`.
 */

/**
 * O Asaas autentica webhooks por token fixo no header, não por HMAC
 * (`plano-refatoracao.md` §5.5). O mock usa o mesmo mecanismo para que a rota
 * não tenha que mudar quando o adaptador real entrar.
 */
export const PAYMENTS_WEBHOOK_TOKEN_HEADER = 'asaas-access-token';
export const DEFAULT_PAYMENTS_WEBHOOK_PATH = '/api/webhooks/payments';
export const DEV_WEBHOOK_SECRET = 'dev-webhook-secret';

export function getPaymentsWebhookSecret(): string {
  const secret = process.env.PAYMENTS_WEBHOOK_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'PAYMENTS_WEBHOOK_SECRET não configurado. Em produção o endpoint de webhook não aceita o valor de desenvolvimento.',
    );
  }
  return DEV_WEBHOOK_SECRET;
}

/**
 * Origem da requisição em curso, quando existir. É a fonte mais confiável em
 * `next dev`: o webhook vai para o mesmo servidor que recebeu a cobrança,
 * independentemente da porta. Fora de request scope (testes, cron) `headers()`
 * lança e a resolução cai para as variáveis de ambiente.
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

/**
 * URL que o mock usa para disparar o webhook em si mesmo (contexto-comum §5.2).
 *
 * Ordem: request atual → `PAYMENTS_WEBHOOK_URL` → `APP_URL` → `PORT`. Se nada
 * resolver, falha com mensagem explícita — melhor não entregar do que entregar
 * no endereço errado em silêncio.
 */
export async function resolvePaymentsWebhookUrl(): Promise<string> {
  const origin = await requestOrigin();
  if (origin) {
    return new URL(DEFAULT_PAYMENTS_WEBHOOK_PATH, origin).toString();
  }

  const explicit = process.env.PAYMENTS_WEBHOOK_URL;
  if (explicit) {
    return explicit;
  }

  const appUrl = process.env.APP_URL;
  if (appUrl) {
    return new URL(DEFAULT_PAYMENTS_WEBHOOK_PATH, appUrl).toString();
  }

  const port = process.env.PORT;
  if (port) {
    return `http://127.0.0.1:${port}${DEFAULT_PAYMENTS_WEBHOOK_PATH}`;
  }

  throw new Error(
    'URL do webhook de pagamentos não resolvida: sem request atual e sem PAYMENTS_WEBHOOK_URL, APP_URL ou PORT. Configure PAYMENTS_WEBHOOK_URL.',
  );
}

export const PAYMENT_WEBHOOK_EVENT_TYPES = [
  'CHARGE_PAID',
  'CHARGE_REFUSED',
  'CHARGE_EXPIRED',
  'CHARGE_REFUNDED',
  'CHARGE_PARTIALLY_REFUNDED',
  'MERCHANT_KYC_UPDATED',
] as const;

export type PaymentWebhookEventType = (typeof PAYMENT_WEBHOOK_EVENT_TYPES)[number];

export interface PaymentWebhookChargeData {
  id: string;
  accountId: string;
  status: ChargeStatus;
  amountCents: number;
  refundedCents: number;
  paidAt?: string;
}

export interface PaymentWebhookMerchantData {
  accountId: string;
  walletId: string;
  kycStatus: KycStatus;
}

export interface PaymentWebhookEvent {
  provider: 'mock';
  eventId: string;
  type: PaymentWebhookEventType;
  occurredAt: string;
  data: {
    charge?: PaymentWebhookChargeData;
    merchant?: PaymentWebhookMerchantData;
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

export function buildMockWebhookRequest(
  event: PaymentWebhookEvent,
  options: { url: string; secret: string },
): WebhookDeliveryRequest {
  return {
    url: options.url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [PAYMENTS_WEBHOOK_TOKEN_HEADER]: options.secret,
    },
    body: JSON.stringify(event),
  };
}

export interface PaymentWebhookInput {
  rawBody: string;
  headers: Headers | Readonly<Record<string, string | undefined>>;
}

export interface PaymentWebhookResult {
  status: 200 | 400 | 401 | 500;
  body: {
    received: boolean;
    duplicate?: boolean;
    applied?: string;
    error?: string;
  };
}

/** Erro de payload: gera 400 e não deve ser mascarado como falha do servidor. */
class WebhookPayloadError extends Error {}

export async function handlePaymentWebhook(
  input: PaymentWebhookInput,
  store: MockPaymentStore = getMockPaymentStore(),
): Promise<PaymentWebhookResult> {
  let expectedToken: string;
  try {
    expectedToken = getPaymentsWebhookSecret();
  } catch (error) {
    return { status: 500, body: { received: false, error: errorMessage(error) } };
  }

  const providedToken = readHeader(input.headers, PAYMENTS_WEBHOOK_TOKEN_HEADER);
  if (!providedToken || !safeEqual(providedToken, expectedToken)) {
    return { status: 401, body: { received: false, error: 'token inválido' } };
  }

  const event = parsePaymentWebhookEvent(input.rawBody);
  if (!event) {
    return { status: 400, body: { received: false, error: 'payload inválido' } };
  }

  const eventKey = `${event.provider}:${event.eventId}`;
  if (store.appliedWebhookEvents.has(eventKey)) {
    // Providers reentregam: evento repetido sai 200 sem reprocessar
    // (`fases/contexto-comum.md` §6.2).
    return { status: 200, body: { received: true, duplicate: true } };
  }

  store.appliedWebhookEvents.set(eventKey, new Date().toISOString());
  try {
    const applied = applyMockWebhookEvent(event, store);
    return { status: 200, body: { received: true, applied } };
  } catch (error) {
    // Se o processamento falhou, o evento não está aplicado: libera a chave
    // para a reentrega conseguir processar.
    store.appliedWebhookEvents.delete(eventKey);
    if (error instanceof WebhookPayloadError) {
      return { status: 400, body: { received: false, error: error.message } };
    }
    return { status: 500, body: { received: false, error: errorMessage(error) } };
  }
}

/**
 * Aplica o evento à projeção local. Nunca usa os valores do payload como
 * verdade: confronta com o registro do provedor e só então atualiza o estado
 * do lado da aplicação, que é o que o console /dev exibe.
 */
function applyMockWebhookEvent(event: PaymentWebhookEvent, store: MockPaymentStore): string {
  if (event.type === 'MERCHANT_KYC_UPDATED') {
    const merchantData = event.data.merchant;
    if (!merchantData) {
      throw new WebhookPayloadError('evento de KYC sem dados da conta');
    }
    const local = store.merchants.get(merchantData.accountId);
    if (!local) {
      throw new WebhookPayloadError(`conta desconhecida: ${merchantData.accountId}`);
    }
    if (local.kycStatus !== merchantData.kycStatus) {
      throw new WebhookPayloadError('status de KYC do payload diverge do provedor');
    }
    store.appMerchants.set(local.accountId, {
      accountId: local.accountId,
      kycStatus: merchantData.kycStatus,
      updatedAt: event.occurredAt,
    });
    return `merchant:${local.accountId}:${merchantData.kycStatus}`;
  }

  const chargeData = event.data.charge;
  if (!chargeData) {
    throw new WebhookPayloadError('evento de cobrança sem dados da cobrança');
  }
  const local = store.charges.get(chargeData.id);
  if (!local) {
    throw new WebhookPayloadError(`cobrança desconhecida: ${chargeData.id}`);
  }
  if (local.accountId !== chargeData.accountId) {
    throw new WebhookPayloadError('conta do payload diverge do provedor');
  }
  if (local.amountCents !== chargeData.amountCents) {
    throw new WebhookPayloadError('valor do payload diverge do provedor');
  }

  const status = statusForEvent(event.type);
  store.appCharges.set(local.id, {
    chargeId: local.id,
    status,
    paidAt: local.paidAt,
    refundedCents: sumRefunds(store, local.id),
    lastEventType: event.type,
    updatedAt: event.occurredAt,
  });
  return `charge:${local.id}:${status}`;
}

function statusForEvent(type: PaymentWebhookEventType): ChargeStatus {
  switch (type) {
    case 'CHARGE_PAID':
      return 'PAID';
    case 'CHARGE_REFUSED':
      return 'REFUSED';
    case 'CHARGE_EXPIRED':
      return 'EXPIRED';
    case 'CHARGE_REFUNDED':
      return 'REFUNDED';
    case 'CHARGE_PARTIALLY_REFUNDED':
      return 'PARTIALLY_REFUNDED';
    case 'MERCHANT_KYC_UPDATED':
      throw new WebhookPayloadError('evento de KYC não muda cobrança');
  }
}

export function sumRefunds(store: MockPaymentStore, chargeId: string): number {
  let total = 0;
  for (const refund of store.refunds.values()) {
    if (refund.chargeId === chargeId) {
      total += refund.amountCents;
    }
  }
  return total;
}

const CHARGE_STATUSES: readonly ChargeStatus[] = [
  'PENDING',
  'PAID',
  'REFUSED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

const KYC_STATUSES: readonly KycStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

function parsePaymentWebhookEvent(rawBody: string): PaymentWebhookEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.provider !== 'mock') {
    return null;
  }
  const { eventId, type, occurredAt, data } = value;
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return null;
  }
  if (!isWebhookEventType(type)) {
    return null;
  }
  if (typeof occurredAt !== 'string' || occurredAt.length === 0) {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }

  const charge = isRecord(data.charge) ? parseChargeData(data.charge) : undefined;
  const merchant = isRecord(data.merchant) ? parseMerchantData(data.merchant) : undefined;
  if (!charge && !merchant) {
    return null;
  }

  return {
    provider: 'mock',
    eventId,
    type,
    occurredAt,
    data: {
      ...(charge ? { charge } : {}),
      ...(merchant ? { merchant } : {}),
    },
  };
}

function parseChargeData(value: Record<string, unknown>): PaymentWebhookChargeData | null {
  const { id, accountId, status, amountCents, refundedCents, paidAt } = value;
  if (typeof id !== 'string' || typeof accountId !== 'string') {
    return null;
  }
  if (typeof status !== 'string' || !CHARGE_STATUSES.includes(status as ChargeStatus)) {
    return null;
  }
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents)) {
    return null;
  }
  if (typeof refundedCents !== 'number' || !Number.isInteger(refundedCents)) {
    return null;
  }
  if (paidAt !== undefined && typeof paidAt !== 'string') {
    return null;
  }
  return {
    id,
    accountId,
    status: status as ChargeStatus,
    amountCents,
    refundedCents,
    ...(typeof paidAt === 'string' ? { paidAt } : {}),
  };
}

function parseMerchantData(value: Record<string, unknown>): PaymentWebhookMerchantData | null {
  const { accountId, walletId, kycStatus } = value;
  if (typeof accountId !== 'string' || typeof walletId !== 'string') {
    return null;
  }
  if (typeof kycStatus !== 'string' || !KYC_STATUSES.includes(kycStatus as KycStatus)) {
    return null;
  }
  return { accountId, walletId, kycStatus: kycStatus as KycStatus };
}

function isWebhookEventType(value: unknown): value is PaymentWebhookEventType {
  return (
    typeof value === 'string' &&
    (PAYMENT_WEBHOOK_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readHeader(
  headers: Headers | Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const record = headers as Readonly<Record<string, string | undefined>>;
  return record[name] ?? record[name.toLowerCase()];
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
