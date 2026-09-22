import type { Prisma } from '@prisma/client';
import {
  incomingStatusForEvent,
  planSubscriptionTransition,
  validateSubscriptionPayload,
  SubscriptionPayloadError,
} from '@/lib/billing/subscription';
import type { BillingSubscriptionStatus } from '@/lib/billing/types';
import { isBillingPlanCode } from '@/lib/billing/plans';
import {
  BILLING_WEBHOOK_EVENT_TYPES,
  type BillingWebhookEvent,
  type BillingWebhookSubscriptionData,
} from '@/lib/billing/webhook';
import { listAllTenantIds } from '@/lib/tenant/context';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';

/**
 * Núcleo persistente do webhook de billing (tarefa F7.2).
 *
 * A rota `route.ts` verifica a assinatura HMAC e faz o parse; este módulo é
 * quem toca no banco. Ele pressupõe payload JÁ autenticado — nunca o chame a
 * partir de entrada não verificada.
 *
 * ISOLAMENTO. O webhook é ator de SISTEMA: não tem tenant no caminho. Como
 * `PlatformSub` tem RLS, a resolução percorre os ids de `listAllTenantIds()` e
 * lê cada um por `forTenant()`, com a RLS em vigor — não há bypass. Toda
 * escrita é escopada. A busca é O(tenants); com escala, o caminho é uma tabela
 * de mapeamento global, não abrir mão da RLS.
 *
 * DUAS FASES. Primeiro resolve, em LEITURA, o tenant dono da assinatura
 * (por `stripeSubscriptionId` ou `stripeCustomerId`). Só então abre UMA
 * transação no tenant certo para gravar. Sem isso, cada tenant tentaria um
 * insert em `WebhookEvent` para depois desfazer.
 *
 * IDEMPOTÊNCIA. `WebhookEvent` tem `unique(provider, eventId)`. O insert é a
 * PRIMEIRA operação da transação: reentrega viola a unique (P2002), a transação
 * desfaz e a rota responde 200 sem reprocessar. Se o processamento falhar
 * depois, a transação inteira desfaz — inclusive o insert — e a reentrega
 * consegue processar (contexto-comum.md §6).
 *
 * REENTRÂNCIA. Tudo roda na callback do client escopado, que pode ser
 * reexecutada sob P2034. Não há chamada externa, e toda escrita decorre do
 * estado relido na própria transação — reexecutar converge.
 *
 * PAYLOAD É ENTRADA NÃO CONFIÁVEL. `validateSubscriptionPayload` confronta
 * assinatura, cliente e valor do payload com o registro local, e
 * `incomingStatusForEvent` exige coerência entre tipo do evento e status do
 * payload. Divergência é 400: a única resposta correta para um payload
 * adulterado é recusá-lo, nunca suspender ou creditar com base nele.
 */
export class WebhookProcessingError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookProcessingError';
  }
}

export interface BillingWebhookResult {
  status: 200;
  body: {
    received: boolean;
    duplicate?: boolean;
    applied?: string;
  };
}

export interface ProcessBillingWebhookOptions {
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
}

export async function processBillingWebhook(
  event: BillingWebhookEvent,
  rawBody: string,
  options: ProcessBillingWebhookOptions = {},
): Promise<BillingWebhookResult> {
  const now = options.now ?? new Date();
  const subscription = event.data.subscription;
  if (!subscription) {
    throw new WebhookProcessingError(400, 'Evento de assinatura sem dados da assinatura.');
  }

  const tenantId = await resolveTenantForSubscription(subscription);
  if (!tenantId) {
    throw new WebhookProcessingError(
      404,
      'Assinatura desconhecida para o evento recebido.',
    );
  }

  try {
    return await forTenant(tenantId, (tx) =>
      processInTransaction(tx, tenantId, event, rawBody, now),
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    throw error;
  }
}

/** Resolve, em leitura e sob RLS, a qual tenant a assinatura pertence. */
async function resolveTenantForSubscription(
  subscription: BillingWebhookSubscriptionData,
): Promise<string | null> {
  const tenantIds = await listAllTenantIds();

  for (const tenantId of tenantIds) {
    const found = await forTenant(tenantId, async (tx) => {
      const row = await tx.platformSub.findFirst({
        where: {
          tenantId,
          OR: [
            { stripeSubscriptionId: subscription.id },
            { stripeCustomerId: subscription.customerId },
          ],
        },
        select: { id: true },
      });
      return row !== null;
    });
    if (found) return tenantId;
  }

  return null;
}

async function processInTransaction(
  tx: TenantTransaction,
  tenantId: string,
  event: BillingWebhookEvent,
  rawBody: string,
  now: Date,
): Promise<BillingWebhookResult> {
  const eventRow = await tx.webhookEvent.create({
    data: {
      provider: event.provider,
      eventId: event.eventId,
      payload: parseRawPayload(rawBody, event),
    },
    select: { id: true },
  });

  const applied = await applySubscriptionEvent(tx, tenantId, event, now);

  await tx.webhookEvent.update({
    where: { id: eventRow.id },
    data: { processedAt: now },
  });

  return { status: 200, body: { received: true, applied: applied.description } };
}

interface AppliedEffect {
  description: string;
}

async function applySubscriptionEvent(
  tx: TenantTransaction,
  tenantId: string,
  event: BillingWebhookEvent,
  now: Date,
): Promise<AppliedEffect> {
  const payload = event.data.subscription;
  if (!payload) {
    throw new WebhookProcessingError(400, 'Evento de assinatura sem dados da assinatura.');
  }

  const local = await tx.platformSub.findUnique({
    where: { tenantId },
    select: {
      plan: true,
      status: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      trialEndedAt: true,
    },
  });
  // Na criação, o registro local existe mas ainda não tem assinatura: ele foi
  // gravado com o `stripeCustomerId` antes de o dono ir para a página do
  // provedor. Nos demais eventos, assinatura local ausente é inconsistência.
  const creating = event.type === 'SUBSCRIPTION_CREATED';
  if (!local || (!creating && !local.stripeSubscriptionId)) {
    throw new WebhookProcessingError(
      404,
      'Assinatura local não encontrada no tenant do evento.',
    );
  }

  let incoming: BillingSubscriptionStatus;
  try {
    validateSubscriptionPayload(
      {
        stripeSubscriptionId: local.stripeSubscriptionId,
        stripeCustomerId: local.stripeCustomerId,
      },
      payload,
      { creating },
    );
    incoming = incomingStatusForEvent(event.type, payload);
  } catch (error) {
    if (error instanceof SubscriptionPayloadError) {
      throw new WebhookProcessingError(400, error.message);
    }
    throw error;
  }

  if (!isBillingPlanCode(payload.plan)) {
    // `validateSubscriptionPayload` já garante isto; a checagem existe para
    // estreitar o tipo antes de gravar.
    throw new WebhookProcessingError(400, `Plano desconhecido no payload: ${payload.plan}.`);
  }

  if (creating) {
    // Reentrega: a assinatura já foi criada e nada muda. Sem isto, um segundo
    // `SUBSCRIPTION_CREATED` reescreveria o estado por cima de eventos mais
    // novos (uma fatura paga, por exemplo) que chegaram no meio.
    if (local.stripeSubscriptionId === payload.id) {
      return { description: `subscription:${payload.id}:created:already` };
    }
    await tx.platformSub.update({
      where: { tenantId },
      data: {
        stripeSubscriptionId: payload.id,
        plan: payload.plan,
        status: incoming,
        currentPeriodEnd: new Date(payload.currentPeriodEnd),
        cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
      },
    });
    return { description: `subscription:${payload.id}:created:${incoming}` };
  }

  const decision = planSubscriptionTransition(local.status, incoming);

  if (decision.kind === 'ignored') {
    return {
      description: `subscription:${local.stripeSubscriptionId}:ignored:${decision.reason}`,
    };
  }

  // Transição `TRIALING → ACTIVE/PAST_DUE` converte a trial de cobrança do
  // provedor: marca quando ela terminou, uma única vez.
  const endedTrial =
    local.status === 'TRIALING' && incoming !== 'TRIALING' && !local.trialEndedAt;

  await tx.platformSub.update({
    where: { tenantId },
    data: {
      plan: payload.plan,
      status: incoming,
      currentPeriodEnd: new Date(payload.currentPeriodEnd),
      // O provedor é a fonte de verdade do cancelamento agendado (F8.4): um
      // `SUBSCRIPTION_CANCELED` agendado chega como `ACTIVE` + flag, e uma
      // reativação (`INVOICE_PAID`) chega com a flag limpa. Gravar sempre
      // evita que a tela perca a verdade no reload.
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd,
      ...(endedTrial ? { trialEndedAt: now } : {}),
    },
  });

  return {
    description: `subscription:${local.stripeSubscriptionId}:${incoming}`,
  };
}

/**
 * Parse do corpo cru. Recusa provedor, eventId, tipo, data ou dados de
 * assinatura inválidos ANTES de qualquer acesso ao banco. Devolve `null` para
 * o chamador responder 400 — nunca lança por payload de forma.
 */
export function parseBillingWebhookEvent(rawBody: string): BillingWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.provider !== 'mock') return null;
  if (typeof candidate.eventId !== 'string' || candidate.eventId.length === 0) return null;
  if (
    typeof candidate.type !== 'string' ||
    !(BILLING_WEBHOOK_EVENT_TYPES as readonly string[]).includes(candidate.type)
  ) {
    return null;
  }
  if (
    typeof candidate.occurredAt !== 'string' ||
    Number.isNaN(new Date(candidate.occurredAt).getTime())
  ) {
    return null;
  }
  if (
    typeof candidate.data !== 'object' ||
    candidate.data === null ||
    Array.isArray(candidate.data)
  ) {
    return null;
  }

  const subscription = (candidate.data as { subscription?: unknown }).subscription;
  if (!isSubscriptionData(subscription)) return null;

  return candidate as unknown as BillingWebhookEvent;
}

function isSubscriptionData(value: unknown): value is BillingWebhookSubscriptionData {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.customerId === 'string' &&
    record.customerId.length > 0 &&
    typeof record.plan === 'string' &&
    typeof record.status === 'string' &&
    typeof record.amountCents === 'number' &&
    Number.isInteger(record.amountCents) &&
    typeof record.currentPeriodEnd === 'string' &&
    !Number.isNaN(new Date(record.currentPeriodEnd).getTime()) &&
    typeof record.cancelAtPeriodEnd === 'boolean'
  );
}

function parseRawPayload(
  rawBody: string,
  event: BillingWebhookEvent,
): Prisma.InputJsonValue {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Prisma.InputJsonValue;
    }
  } catch {
    // Corpo não-JSON já foi recusado pelo parser; aqui é defesa extra.
  }
  return event as unknown as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') {
    return true;
  }
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return meta?.code === 'P2002' || meta?.code === '23505';
}
