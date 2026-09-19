import type { TenantTransaction } from '@/lib/tenant/db';
import { forTenant } from '@/lib/tenant/db';
import { getBillingProvider } from './index';
import {
  assessPlanChange,
  changePlan as applyPlanChangeLocally,
  type PlanChangeAssessment,
} from './limits';
import { BILLING_PLANS, isBillingPlanCode, type BillingPlanCode } from './plans';
import {
  BillingProviderError,
  type BillingProvider,
  type BillingSubscription,
  type BillingSubscriptionStatus,
} from './types';
import type {
  BillingWebhookEventType,
  BillingWebhookSubscriptionData,
} from './webhook';

/**
 * Ciclo de cobrança B2B da plataforma (tarefa F7.2, spec §3.1 e §6.1).
 *
 * O Stripe (mock até a F8.1) cobra SOMENTE a mensalidade do software, na conta
 * única da plataforma. Nada aqui toca Asaas, subconta, carteira, KYC ou split:
 * o dono do salão não tem conta no Stripe e todo o dinheiro B2C é do Asaas, em
 * outra fase. Se alguém procurar `split` neste módulo, está no arquivo errado.
 *
 * ESTE MÓDULO TEM DUAS METADES.
 *
 *   1. Uma máquina de estados PURA (sem banco, HTTP ou Prisma), que decide a
 *      transição de `PlatformSub.status` a partir do evento — é a fonte de
 *      verdade de "estado final, não ordem de chegada" e o que dá para testar
 *      sem subir Postgres. Vive no topo do arquivo e é consumida pelo
 *      processador de webhook (`app/api/webhooks/billing/processor.ts`).
 *   2. O serviço transacional (assinar, trocar, atualizar cartão, cancelar),
 *      que chama o `BillingProvider` FORA da transação escopada — a callback do
 *      client escopado pode ser reexecutada sob P2034 e uma chamada externa lá
 *      dentro duplicaria cobrança. Primeiro o provedor, depois o banco.
 *
 * INADIMPLÊNCIA E SUSPENSÃO GRACIOSA. A escada é: retentativa (o provedor
 * reenvia a fatura) → aviso ao dono → suspensão. `INVOICE_PAYMENT_FAILED` leva
 * o `PlatformSub` para `PAST_DUE`; a partir daí o portão
 * `assertSubscriptionAllowsNewBooking` recusa NOVOS agendamentos. NADA do que
 * já existe é apagado ou escondido: derrubar a agenda de um salão em
 * funcionamento perderia o cliente e criaríamos problema para o consumidor
 * final, que não tem culpa da inadimplência. É a mesma regra que a F7.1
 * aplicou no trial (bloqueia o novo, preserva o existente).
 *
 * REATIVAÇÃO. `INVOICE_PAID` traz o `PlatformSub` de volta para `ACTIVE`. Como
 * a decisão é por estado final, um pagamento atrasado que chegue depois de um
 * cancelamento é ignorado — não se reabre assinatura encerrada.
 */

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

/** Códigos de falha do serviço de assinatura, estáveis para a UI e os testes. */
export type SubscriptionErrorCode =
  | 'TENANT_NOT_FOUND'
  | 'SUBSCRIBER_ALREADY_EXISTS'
  | 'NO_SUBSCRIPTION'
  | 'SAME_PLAN'
  | 'DOWNGRADE_REQUIRES_DECISION'
  | 'INVALID_DEACTIVATION'
  | 'PROVIDER_ERROR';

export class SubscriptionError extends Error {
  readonly code: SubscriptionErrorCode;

  constructor(code: SubscriptionErrorCode, message: string) {
    super(message);
    this.name = 'SubscriptionError';
    this.code = code;
  }
}

/**
 * Violação do payload do webhook. É erro de dado, não de negócio: o provider
 * autenticou, mas o que ele mandou não bate com o registro local (valor,
 * assinatura, plano ou status). A resposta correta é recusar — nunca creditar
 * ou suspender com base em payload adulterado (contexto-comum.md §6.4).
 */
export class SubscriptionPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionPayloadError';
  }
}

/**
 * Portão de suspensão graciosa. Lançado ao tentar criar um agendamento NOVO
 * com a assinatura suspensa (`PAST_DUE`) ou encerrada (`CANCELED`). `status`
 * 402 (Payment Required): a saída é regularizar a mensalidade, não corrigir a
 * requisição.
 */
export class SubscriptionSuspendedError extends Error {
  readonly code = 'SUBSCRIPTION_SUSPENDED' as const;
  readonly status = 402;
  readonly subscription: LocalSubscription;

  constructor(subscription: LocalSubscription) {
    super(
      subscription.status === 'CANCELED'
        ? 'A assinatura do sistema está cancelada. Reative um plano para receber novos agendamentos.'
        : 'A mensalidade do sistema está em atraso. Seus agendamentos continuam disponíveis; regularize o pagamento para receber novos.',
    );
    this.name = 'SubscriptionSuspendedError';
    this.subscription = subscription;
  }
}

// ---------------------------------------------------------------------------
// Máquina de estados pura
// ---------------------------------------------------------------------------

/**
 * Transições PERMITIDAS de `PlatformSub.status` (a auto-transição não entra:
 * estado local igual ao alvo é evento já aplicado, não transição).
 *
 * `CANCELED` é terminal: um pagamento que chegue depois do cancelamento não
 * reabre a assinatura — quem quer voltar assina de novo. Sem isso, um webhook
 * de renovação atrasado ressuscitaria uma assinatura encerrada e voltaria a
 * cobrar um salão que pediu para sair.
 */
export const PERMITTED_SUBSCRIPTION_TRANSITIONS: Readonly<
  Record<BillingSubscriptionStatus, readonly BillingSubscriptionStatus[]>
> = {
  TRIALING: ['ACTIVE', 'PAST_DUE', 'CANCELED'],
  ACTIVE: ['PAST_DUE', 'CANCELED'],
  PAST_DUE: ['ACTIVE', 'CANCELED'],
  CANCELED: [],
};

const ALL_SUBSCRIPTION_STATUSES: readonly BillingSubscriptionStatus[] = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
];

export function isSubscriptionStatus(value: unknown): value is BillingSubscriptionStatus {
  return (
    typeof value === 'string' &&
    (ALL_SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

export function canTransitionSubscription(
  from: BillingSubscriptionStatus,
  to: BillingSubscriptionStatus,
): boolean {
  return PERMITTED_SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/**
 * Assinaturas que bloqueiam agendamento NOVO: suspensão graciosa (`PAST_DUE`) e
 * encerrada (`CANCELED`). `TRIALING` e `ACTIVE` liberam; ausência de
 * `PlatformSub` é a trial do produto (F7.1), que tem o próprio portão.
 */
export const SUSPENDED_SUBSCRIPTION_STATUSES: readonly BillingSubscriptionStatus[] = [
  'PAST_DUE',
  'CANCELED',
];

export function isSubscriptionSuspended(status: BillingSubscriptionStatus): boolean {
  return SUSPENDED_SUBSCRIPTION_STATUSES.includes(status);
}

export type SubscriptionTransitionPlan =
  | { kind: 'applied'; status: BillingSubscriptionStatus }
  | { kind: 'already-applied'; status: BillingSubscriptionStatus }
  | {
      kind: 'ignored';
      reason: 'stale' | 'terminal';
      current: BillingSubscriptionStatus;
      incoming: BillingSubscriptionStatus;
    };

/**
 * Decide o que fazer com um alvo de status, dado o estado LOCAL.
 * `already-applied` e `ignored` são sucessos idempotentes: o evento é
 * registrado e respondido com 200, sem regredir o estado.
 */
export function planSubscriptionTransition(
  current: BillingSubscriptionStatus,
  incoming: BillingSubscriptionStatus,
): SubscriptionTransitionPlan {
  if (current === incoming) {
    return { kind: 'already-applied', status: incoming };
  }
  if (!canTransitionSubscription(current, incoming)) {
    return {
      kind: 'ignored',
      reason: current === 'CANCELED' ? 'terminal' : 'stale',
      current,
      incoming,
    };
  }
  return { kind: 'applied', status: incoming };
}

/**
 * Confronta o payload com o registro local. Não retorna nada: ou é
 * consistente, ou lança. O `amountCents` do payload é confrontado com o preço
 * do plano em `plans.ts`, e não com o valor que o chamador mandou — preço é
 * configuração, nunca dado de entrada.
 */
export function validateSubscriptionPayload(
  local: { stripeSubscriptionId: string | null; stripeCustomerId: string | null },
  payload: BillingWebhookSubscriptionData,
): void {
  if (!local.stripeSubscriptionId) {
    throw new SubscriptionPayloadError('Registro local não tem assinatura do provedor.');
  }
  if (payload.id !== local.stripeSubscriptionId) {
    throw new SubscriptionPayloadError(
      `Assinatura do payload (${payload.id}) diverge do registro local (${local.stripeSubscriptionId}).`,
    );
  }
  if (!local.stripeCustomerId || payload.customerId !== local.stripeCustomerId) {
    throw new SubscriptionPayloadError(
      `Cliente do payload (${payload.customerId}) diverge do registro local.`,
    );
  }
  if (!isBillingPlanCode(payload.plan)) {
    throw new SubscriptionPayloadError(`Plano desconhecido no payload: ${String(payload.plan)}.`);
  }
  if (!isSubscriptionStatus(payload.status)) {
    throw new SubscriptionPayloadError(`Status desconhecido no payload: ${String(payload.status)}.`);
  }
  if (!Number.isInteger(payload.amountCents) || payload.amountCents < 0) {
    throw new SubscriptionPayloadError('amountCents do payload não é inteiro em centavos.');
  }
  const expected = BILLING_PLANS[payload.plan].priceCents;
  if (payload.amountCents !== expected) {
    throw new SubscriptionPayloadError(
      `Valor do payload (${payload.amountCents}) diverge do preço configurado do plano ${payload.plan} (${expected}).`,
    );
  }
  if (Number.isNaN(new Date(payload.currentPeriodEnd).getTime())) {
    throw new SubscriptionPayloadError('currentPeriodEnd do payload não é data válida.');
  }
}

/**
 * Converte o tipo do evento no status alvo do `PlatformSub`, validando a
 * coerência entre tipo e status do payload. Um `INVOICE_PAID` que diz
 * `CANCELED` (ou um `SUBSCRIPTION_CANCELED` com status arbitrário) é payload
 * inconsistente e vira 400, não transição.
 */
export function incomingStatusForEvent(
  type: BillingWebhookEventType,
  payload: BillingWebhookSubscriptionData,
): BillingSubscriptionStatus {
  switch (type) {
    case 'INVOICE_PAID':
      if (payload.status !== 'ACTIVE') {
        throw new SubscriptionPayloadError(
          `INVOICE_PAID exige status ACTIVE no payload (recebido: ${payload.status}).`,
        );
      }
      return 'ACTIVE';
    case 'INVOICE_PAYMENT_FAILED':
      if (payload.status !== 'PAST_DUE') {
        throw new SubscriptionPayloadError(
          `INVOICE_PAYMENT_FAILED exige status PAST_DUE no payload (recebido: ${payload.status}).`,
        );
      }
      return 'PAST_DUE';
    case 'SUBSCRIPTION_CANCELED':
      // Imediato: CANCELED. Agendado para o fim do período: ACTIVE com
      // `cancelAtPeriodEnd`. Sem a flag, qualquer outro status é inconsistente.
      if (payload.status === 'CANCELED') return 'CANCELED';
      if (payload.status === 'ACTIVE' && payload.cancelAtPeriodEnd) return 'ACTIVE';
      throw new SubscriptionPayloadError(
        `SUBSCRIPTION_CANCELED com status inconsistente no payload (${payload.status}).`,
      );
    case 'SUBSCRIPTION_UPDATED':
      return payload.status;
  }
}

// ---------------------------------------------------------------------------
// Leitura do estado local
// ---------------------------------------------------------------------------

/** Visão de `PlatformSub` que o serviço e a UI expõem — sem vazar o shape cru. */
export interface LocalSubscription {
  tenantId: string;
  plan: BillingPlanCode;
  status: BillingSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  trialEndedAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

const LOCAL_SUBSCRIPTION_SELECT = {
  tenantId: true,
  plan: true,
  status: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  currentPeriodEnd: true,
  trialEndedAt: true,
} as const;

function toLocalSubscription(row: {
  tenantId: string;
  plan: BillingPlanCode;
  status: BillingSubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  trialEndedAt: Date | null;
}): LocalSubscription {
  return {
    tenantId: row.tenantId,
    plan: row.plan,
    status: row.status,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    currentPeriodEnd: row.currentPeriodEnd,
    trialEndedAt: row.trialEndedAt,
    // `PlatformSub` não guarda a flag de cancelamento agendado (coluna fora do
    // escopo da F7.2); o estado local a projeta como `false`. O cancelamento
    // imediato chega por webhook e vira `CANCELED`.
    cancelAtPeriodEnd: false,
  };
}

/** Assinatura local do tenant, ou `null` quando ele ainda está na trial. */
export async function getLocalSubscription(
  tenantId: string,
): Promise<LocalSubscription | null> {
  return forTenant(tenantId, (tx) => getLocalSubscriptionInTransaction(tx, tenantId));
}

export async function getLocalSubscriptionInTransaction(
  tx: TenantTransaction,
  tenantId: string,
): Promise<LocalSubscription | null> {
  const row = await tx.platformSub.findUnique({
    where: { tenantId },
    select: LOCAL_SUBSCRIPTION_SELECT,
  });
  return row ? toLocalSubscription(row) : null;
}

// ---------------------------------------------------------------------------
// Portão de novos agendamentos (suspensão graciosa)
// ---------------------------------------------------------------------------

/**
 * Recusa a criação de agendamento NOVO quando a assinatura está suspensa, sem
 * tocar em nada do que já existe. Chamado por `createHold` DENTRO da mesma
 * transação do hold, logo após o portão de trial da F7.1 — a porta de entrada
 * de todo agendamento novo. A remarcação usa `createHoldInTransaction` direto e
 * continua liberada, porque mover um horário existente não é criar agendamento.
 */
export async function assertSubscriptionAllowsNewBooking(
  tx: TenantTransaction,
  tenantId: string,
): Promise<void> {
  const subscription = await getLocalSubscriptionInTransaction(tx, tenantId);
  if (subscription && isSubscriptionSuspended(subscription.status)) {
    throw new SubscriptionSuspendedError(subscription);
  }
}

// ---------------------------------------------------------------------------
// Serviço: assinar, trocar de plano, atualizar cartão, cancelar
// ---------------------------------------------------------------------------

export interface BillingCardInput {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface SubscribeInput {
  tenantId: string;
  plan: BillingPlanCode;
  card: BillingCardInput;
  /** Trial de COBRANÇA do provedor; ortogonal à trial por valor da F7.1. */
  trialEndsAt?: string;
  /** Injetável em teste; o padrão é a factory por `BILLING_PROVIDER`. */
  provider?: BillingProvider;
}

export type SubscribeResult =
  | { ok: true; subscription: LocalSubscription; providerSubscription: BillingSubscription }
  | { ok: false; code: 'TENANT_NOT_FOUND' | 'SUBSCRIBER_ALREADY_EXISTS'; message: string };

/**
 * Assina um plano. O cliente de cobrança e a assinatura nascem no provedor
 * (fora da transação) e só então o `PlatformSub` local é gravado — o webhook
 * que o provedor disparar dali em diante encontra o `stripeSubscriptionId` para
 * resolver o tenant.
 *
 * O porteiro local (`SUBSCRIBER_ALREADY_EXISTS`) evita assinatura dupla: um
 * segundo POST do dono não cria uma segunda cobrança. Se a assinatura estiver
 * `CANCELED`, assinar de novo é permitido e reaproveita o cliente de cobrança.
 */
export async function subscribe(input: SubscribeInput): Promise<SubscribeResult> {
  const provider = input.provider ?? getBillingProvider();

  const tenant = await forTenant(input.tenantId, (tx) =>
    tx.tenant.findUnique({
      where: { id: input.tenantId },
      select: { name: true, document: true },
    }),
  );
  if (!tenant) {
    return {
      ok: false,
      code: 'TENANT_NOT_FOUND',
      message: `Tenant não encontrado: ${input.tenantId}.`,
    };
  }

  const existing = await getLocalSubscription(input.tenantId);
  if (existing && existing.status !== 'CANCELED') {
    return {
      ok: false,
      code: 'SUBSCRIBER_ALREADY_EXISTS',
      message: 'O estabelecimento já possui uma assinatura ativa.',
    };
  }

  const customer = existing?.stripeCustomerId
    ? await provider.getCustomer(existing.stripeCustomerId)
    : await provider.createCustomer({
        tenantId: input.tenantId,
        name: tenant.name,
        document: tenant.document,
      });

  const { token } = await provider.tokenizeCard({
    customerId: customer.id,
    holderName: input.card.holderName,
    number: input.card.number,
    expiryMonth: input.card.expiryMonth,
    expiryYear: input.card.expiryYear,
    ccv: input.card.ccv,
  });

  const providerSubscription = await provider.createSubscription({
    customerId: customer.id,
    plan: input.plan,
    cardToken: token,
    externalReference: input.tenantId,
    ...(input.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
  });

  const subscription = await persistSubscription(input.tenantId, providerSubscription);
  return { ok: true, subscription, providerSubscription };
}

export interface ChangeSubscriptionPlanInput {
  tenantId: string;
  plan: BillingPlanCode;
  /**
   * Decisão explícita do dono no downgrade: ids de `StaffProfile` a desativar.
   * Precisa cobrir o excesso; ids de outro tenant são ignorados pela RLS.
   */
  deactivateStaffIds?: readonly string[];
  provider?: BillingProvider;
}

export type ChangeSubscriptionPlanResult =
  | {
      ok: true;
      plan: BillingPlanCode;
      deactivatedStaffIds: string[];
      subscription: LocalSubscription;
      providerSubscription: BillingSubscription;
    }
  | {
      ok: false;
      code:
        | 'NO_SUBSCRIPTION'
        | 'SAME_PLAN'
        | 'DOWNGRADE_REQUIRES_DECISION'
        | 'INVALID_DEACTIVATION'
        | 'PROVIDER_ERROR';
      message: string;
      assessment: PlanChangeAssessment;
    };

/**
 * Troca de plano com proração.
 *
 * ORDEM: a decisão de downgrade e a gravação LOCAL vêm PRIMEIRO; a chamada ao
 * provedor (que calcula a proração) vem depois. Se o provedor recusar, o estado
 * local é revertido na mesma medida — sem isso o salão ficaria no plano novo
 * sem a cobrança correspondente. As chamadas ao provedor nunca entram na
 * callback escopada.
 *
 * A reversão é a razão de a ordem ser esta e não a inversa: com transporte
 * síncrono (o mock dispara o webhook na hora), o webhook de
 * `SUBSCRIPTION_UPDATED` já teria gravado o plano novo antes de
 * `limits.changePlan` reavaliar — e a reavaliação veria "mesmo plano". Gravar
 * local antes torna o webhook um no-op idempotente.
 */
export async function changePlan(
  input: ChangeSubscriptionPlanInput,
): Promise<ChangeSubscriptionPlanResult> {
  const provider = input.provider ?? getBillingProvider();

  const existing = await getLocalSubscription(input.tenantId);
  const assessment = await forTenant(input.tenantId, (tx) =>
    assessPlanChange(tx, input.tenantId, input.plan),
  );

  if (!existing || !existing.stripeSubscriptionId) {
    return {
      ok: false,
      code: 'NO_SUBSCRIPTION',
      message: 'Não há assinatura para trocar. Assine um plano primeiro.',
      assessment,
    };
  }
  if (assessment.direction === 'SAME') {
    return {
      ok: false,
      code: 'SAME_PLAN',
      message: `O tenant já está no plano ${BILLING_PLANS[input.plan].name}.`,
      assessment,
    };
  }

  // Aplica localmente (e resolve a decisão de downgrade) ANTES do provedor.
  const applied = await forTenant(input.tenantId, (tx) =>
    applyPlanChangeLocally(tx, input.tenantId, input.plan, {
      deactivateStaffIds: input.deactivateStaffIds ?? [],
    }),
  );
  if (!applied.ok) {
    return {
      ok: false,
      code: applied.code,
      message: applied.message,
      assessment: applied.assessment,
    };
  }

  try {
    const providerSubscription = await provider.changePlan(
      existing.stripeSubscriptionId,
      input.plan,
    );
    const subscription = await getLocalSubscription(input.tenantId);
    return {
      ok: true,
      plan: applied.plan,
      deactivatedStaffIds: applied.deactivatedStaffIds,
      subscription: subscription ?? existing,
      providerSubscription,
    };
  } catch (error) {
    await revertLocalPlanChange(
      input.tenantId,
      existing.plan,
      applied.deactivatedStaffIds,
    );
    return {
      ok: false,
      code: 'PROVIDER_ERROR',
      message: providerErrorMessage(error),
      assessment,
    };
  }
}

export interface UpdatePaymentMethodInput {
  tenantId: string;
  card: BillingCardInput;
  provider?: BillingProvider;
}

export type UpdatePaymentMethodResult =
  | { ok: true; providerSubscription: BillingSubscription }
  | { ok: false; code: 'NO_SUBSCRIPTION'; message: string };

/**
 * Troca o cartão da assinatura. O cartão é tokenizado pelo provedor e o token
 * nunca é persistido localmente: guardar token de cartão seria dado de
 * pagamento que não precisamos.
 */
export async function updatePaymentMethod(
  input: UpdatePaymentMethodInput,
): Promise<UpdatePaymentMethodResult> {
  const provider = input.provider ?? getBillingProvider();

  const existing = await getLocalSubscription(input.tenantId);
  if (!existing || !existing.stripeSubscriptionId || !existing.stripeCustomerId) {
    return {
      ok: false,
      code: 'NO_SUBSCRIPTION',
      message: 'Não há assinatura para atualizar o meio de pagamento.',
    };
  }

  const { token } = await provider.tokenizeCard({
    customerId: existing.stripeCustomerId,
    holderName: input.card.holderName,
    number: input.card.number,
    expiryMonth: input.card.expiryMonth,
    expiryYear: input.card.expiryYear,
    ccv: input.card.ccv,
  });
  const providerSubscription = await provider.updatePaymentMethod(
    existing.stripeSubscriptionId,
    token,
  );
  return { ok: true, providerSubscription };
}

export interface CancelSubscriptionInput {
  tenantId: string;
  /**
   * `true` agenda o cancelamento para o fim do período. O estado local só muda
   * quando o provedor confirma (webhook); a coluna de "cancelamento agendado"
   * está fora do escopo da F7.2, então o caminho imediato é o exercitado.
   */
  atPeriodEnd?: boolean;
  provider?: BillingProvider;
}

export type CancelSubscriptionResult =
  | { ok: true; providerSubscription: BillingSubscription }
  | { ok: false; code: 'NO_SUBSCRIPTION'; message: string };

/**
 * Cancela a assinatura. O estado local NÃO é alterado aqui: quem grava
 * `CANCELED` é o processador do webhook `SUBSCRIPTION_CANCELED`, garantindo que
 * o provedor é a fonte de verdade também no cancelamento.
 */
export async function cancelSubscription(
  input: CancelSubscriptionInput,
): Promise<CancelSubscriptionResult> {
  const provider = input.provider ?? getBillingProvider();

  const existing = await getLocalSubscription(input.tenantId);
  if (!existing || !existing.stripeSubscriptionId) {
    return {
      ok: false,
      code: 'NO_SUBSCRIPTION',
      message: 'Não há assinatura para cancelar.',
    };
  }

  const providerSubscription = await provider.cancelSubscription(
    existing.stripeSubscriptionId,
    input.atPeriodEnd ?? false,
  );
  return { ok: true, providerSubscription };
}

// ---------------------------------------------------------------------------
// Persistência
// ---------------------------------------------------------------------------

async function persistSubscription(
  tenantId: string,
  providerSubscription: BillingSubscription,
): Promise<LocalSubscription> {
  const currentPeriodEnd = new Date(providerSubscription.currentPeriodEnd);
  const trialEndedAt = providerSubscription.trialEndsAt
    ? new Date(providerSubscription.trialEndsAt)
    : null;

  const row = await forTenant(tenantId, (tx) =>
    tx.platformSub.upsert({
      where: { tenantId },
      create: {
        tenantId,
        stripeCustomerId: providerSubscription.customerId,
        stripeSubscriptionId: providerSubscription.id,
        plan: providerSubscription.plan,
        status: providerSubscription.status,
        currentPeriodEnd,
        trialEndedAt,
      },
      update: {
        stripeCustomerId: providerSubscription.customerId,
        stripeSubscriptionId: providerSubscription.id,
        plan: providerSubscription.plan,
        status: providerSubscription.status,
        currentPeriodEnd,
        trialEndedAt,
      },
      select: LOCAL_SUBSCRIPTION_SELECT,
    }),
  );
  return toLocalSubscription(row);
}

/** Desfaz a troca local quando o provedor recusa a proração. */
async function revertLocalPlanChange(
  tenantId: string,
  previousPlan: BillingPlanCode,
  deactivatedStaffIds: readonly string[],
): Promise<void> {
  await forTenant(tenantId, async (tx) => {
    if (deactivatedStaffIds.length > 0) {
      await tx.staffProfile.updateMany({
        where: { tenantId, id: { in: [...deactivatedStaffIds] } },
        data: { active: true },
      });
    }
    await tx.platformSub.update({
      where: { tenantId },
      data: { plan: previousPlan },
    });
  });
}

function providerErrorMessage(error: unknown): string {
  if (error instanceof BillingProviderError) {
    return `Provedor recusou a troca de plano: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
