import type { Prisma } from '@prisma/client';
import {
  computePlatformFeeCents,
  getPlatformWalletId,
  tenantDateString,
} from '@/lib/payments/charge';
import { getPaymentProvider } from '@/lib/payments';
import {
  PaymentProviderError,
  type PaymentProvider,
  type Split,
  type SubscriptionCycle,
} from '@/lib/payments/types';
import { firstIpFromHeader, isPublicIp, resolvePayerIp } from '@/lib/payments/remote-ip';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import { listAllTenantIds } from '@/lib/tenant/context';
import { type MembershipCycle } from './plans';

/**
 * Assinatura do clube do estabelecimento (tarefa F5.1, fase 5 itens 2 e 5).
 *
 * O clube pertence ao TENANT: preço, ciclo e recebimento são do salão. Nada
 * aqui reaproveita a assinatura antiga de plataforma — o modelo é `Membership`
 * sobre `MembershipPlan`.
 *
 * O MÓDULO TEM TRÊS METADES.
 *
 *   1. Uma máquina de estados PURA (topo do arquivo), sem banco, HTTP ou Prisma,
 *      que decide a transição de `MembershipStatus` a partir do evento. É a
 *      fonte de verdade de "estado final, não ordem de chegada" e o que dá para
 *      testar sem subir Postgres.
 *   2. O serviço transacional (assinar, cancelar), que chama o `PaymentProvider`
 *      FORA da transação escopada — a callback do client escopado pode ser
 *      reexecutada sob P2034 e uma chamada externa lá dentro cobraria duas
 *      vezes. Primeiro o provedor, depois o banco.
 *   3. O processador do webhook (`processMembershipWebhook`), que segue o
 *      contrato de `fases/contexto-comum.md` §6: idempotência por
 *      `WebhookEvent(provider, eventId)`, transação escopada e payload sempre
 *      confrontado com o registro local.
 *
 * RESTRIÇÕES REAIS DO PROVIDER (`plano-refatoracao.md` §1.1). A cobrança nasce
 * na SUBCONTA do salão (`AsaasAccount.asaasAccountId`) e o split leva só a taxa
 * para a carteira da plataforma. O contrário — cobrar na conta principal e
 * repassar por transferência — transforma o faturamento do salão em receita da
 * empresa de software perante a Receita Federal. O `accountId` NUNCA vem do
 * chamador: é lido da conta do tenant; há teste que falha se essa direção
 * inverter.
 *
 * O `remoteIp` é o IP do DISPOSITIVO DO PAGADOR, nunca o do servidor. O serviço
 * recusa antes de tocar no provedor (que também recusaria), e a ausência do
 * header é erro — nunca cai para o IP do servidor como fallback.
 *
 * PREÇO CONGELADO. Quem cobra lê `Membership.contractedPriceCents`, nunca
 * `plan.priceCents`: o dono pode reajustar o plano e quem já assinou continua no
 * preço que aceitou (o seed monta exatamente esse caso). A validação do webhook
 * também confronta o valor do payload com o preço CONTRATADO.
 *
 * CRÉDITOS SÃO DA F5.2. Este módulo decide a POLÍTICA (quando o ciclo credita,
 * o que acontece com o crédito não usado ao cancelar) e transiciona o
 * `Membership`; escrever `CreditLedger` é de `lib/membership/credits.ts`. As
 * funções de política aqui são puras e existem para a F5.2 consumir.
 */

// ---------------------------------------------------------------------------
// Tipos de estado e transições
// ---------------------------------------------------------------------------

/** Espelha o enum `MembershipStatus` do schema, sem importar o valor do Prisma. */
export const MEMBERSHIP_STATUSES = ['ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Transições PERMITIDAS de status (a auto-transição não entra: estado local
 * igual ao alvo é evento já aplicado, exceto a renovação, que avança o período).
 *
 * `CANCELED` e `EXPIRED` são terminais: uma renovação atrasada não ressuscita
 * assinatura encerrada. Sem isso, um webhook fora de ordem voltaria a cobrar
 * quem pediu para sair.
 */
export const PERMITTED_MEMBERSHIP_TRANSITIONS: Readonly<
  Record<MembershipStatus, readonly MembershipStatus[]>
> = {
  ACTIVE: ['PAST_DUE', 'CANCELED', 'EXPIRED'],
  PAST_DUE: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  CANCELED: [],
  EXPIRED: [],
};

export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === 'string' && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export function canTransitionMembership(from: MembershipStatus, to: MembershipStatus): boolean {
  return PERMITTED_MEMBERSHIP_TRANSITIONS[from].includes(to);
}

/** Estados que suspendem a CONCESSÃO de novos créditos e o consumo do clube. */
export const SUSPENDED_MEMBERSHIP_STATUSES: readonly MembershipStatus[] = [
  'PAST_DUE',
  'CANCELED',
  'EXPIRED',
];

export function isMembershipSuspended(status: MembershipStatus): boolean {
  return SUSPENDED_MEMBERSHIP_STATUSES.includes(status);
}

// ---------------------------------------------------------------------------
// Ciclos
// ---------------------------------------------------------------------------

/**
 * O port do provider só aceita `MONTHLY | QUARTERLY | YEARLY`
 * (`SubscriptionCycle`), enquanto o `MembershipPlan` aceita seis ciclos. Assinar
 * um plano semanal/quinzenal/semestral é recusado com código próprio em vez de
 * silenciosamente virar mensal. Estender `SubscriptionCycle` é alteração de port
 * (F0.3/F8.2), por isso fica fora do escopo desta tarefa.
 */
const PROVIDER_CYCLE: Partial<Record<MembershipCycle, SubscriptionCycle>> = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
};

const CYCLE_MONTHS: Partial<Record<MembershipCycle, number>> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  YEARLY: 12,
};

export function providerCycleFor(cycle: MembershipCycle): SubscriptionCycle | null {
  return PROVIDER_CYCLE[cycle] ?? null;
}

// ---------------------------------------------------------------------------
// Máquina de estados pura
// ---------------------------------------------------------------------------

export const MEMBERSHIP_WEBHOOK_EVENT_TYPES = [
  'SUBSCRIPTION_CYCLE_RENEWED',
  'SUBSCRIPTION_PAYMENT_FAILED',
  'SUBSCRIPTION_CANCELED',
  'SUBSCRIPTION_EXPIRED',
] as const;

export type MembershipWebhookEventType = (typeof MEMBERSHIP_WEBHOOK_EVENT_TYPES)[number];

export interface MembershipWebhookSubscriptionData {
  /** Id da assinatura no provedor. */
  id: string;
  /** Subconta do salão que criou a cobrança. */
  accountId: string;
  /** Id local do `TenantMember` do assinante. */
  customerId: string;
  /** Id local do `MembershipPlan`. */
  planId: string;
  /** `externalReference` da assinatura: id local do `Membership`. */
  membershipId: string;
  status: MembershipStatus;
  /** Preço CONTRATADO, em centavos. */
  amountCents: number;
  /** Fim do ciclo, ISO. */
  currentPeriodEnd: string;
}

export interface MembershipWebhookEvent {
  provider: string;
  eventId: string;
  type: MembershipWebhookEventType;
  occurredAt: string;
  data: { subscription?: MembershipWebhookSubscriptionData };
}

/**
 * Erro de payload: divergência entre o que o provedor mandou e o registro
 * local. A resposta correta é recusar (400) — nunca creditar, suspender ou
 * cancelar com base em payload adulterado.
 */
export class MembershipPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MembershipPayloadError';
  }
}

export interface LocalMembershipState {
  id: string;
  planId: string;
  status: MembershipStatus;
  contractedPriceCents: number;
  asaasSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
}

/**
 * Confronta o payload com o registro local. Não retorna nada: ou é consistente,
 * ou lança. `amountCents` é comparado com o preço CONTRATADO (congelado), nunca
 * com `plan.priceCents` — payload é entrada não confiável e o preço do plano
 * pode ter mudado.
 */
export function validateMembershipPayload(
  local: LocalMembershipState,
  payload: MembershipWebhookSubscriptionData,
): void {
  if (!local.asaasSubscriptionId) {
    throw new MembershipPayloadError('Registro local não tem assinatura do provedor.');
  }
  if (payload.id !== local.asaasSubscriptionId) {
    throw new MembershipPayloadError(
      `Assinatura do payload (${payload.id}) diverge do registro local (${local.asaasSubscriptionId}).`,
    );
  }
  if (payload.membershipId !== local.id) {
    throw new MembershipPayloadError(
      `Assinatura local do payload (${payload.membershipId}) diverge do registro (${local.id}).`,
    );
  }
  if (payload.planId !== local.planId) {
    throw new MembershipPayloadError(
      `Plano do payload (${payload.planId}) diverge do plano contratado (${local.planId}).`,
    );
  }
  if (!Number.isInteger(payload.amountCents) || payload.amountCents <= 0) {
    throw new MembershipPayloadError('amountCents do payload não é inteiro positivo em centavos.');
  }
  if (payload.amountCents !== local.contractedPriceCents) {
    throw new MembershipPayloadError(
      `Valor do payload (${payload.amountCents}) diverge do preço contratado (${local.contractedPriceCents}).`,
    );
  }
  if (Number.isNaN(new Date(payload.currentPeriodEnd).getTime())) {
    throw new MembershipPayloadError('currentPeriodEnd do payload não é data válida.');
  }
}

/**
 * Converte o tipo do evento no status alvo, exigindo coerência entre tipo e
 * status do payload. Um `SUBSCRIPTION_PAYMENT_FAILED` que diz `ACTIVE` é payload
 * inconsistente e vira 400, não transição.
 */
export function incomingStatusForMembershipEvent(
  type: MembershipWebhookEventType,
  payload: MembershipWebhookSubscriptionData,
): MembershipStatus {
  switch (type) {
    case 'SUBSCRIPTION_CYCLE_RENEWED':
      if (payload.status !== 'ACTIVE') {
        throw new MembershipPayloadError(
          `SUBSCRIPTION_CYCLE_RENEWED exige status ACTIVE no payload (recebido: ${payload.status}).`,
        );
      }
      return 'ACTIVE';
    case 'SUBSCRIPTION_PAYMENT_FAILED':
      if (payload.status !== 'PAST_DUE') {
        throw new MembershipPayloadError(
          `SUBSCRIPTION_PAYMENT_FAILED exige status PAST_DUE no payload (recebido: ${payload.status}).`,
        );
      }
      return 'PAST_DUE';
    case 'SUBSCRIPTION_CANCELED':
      if (payload.status !== 'CANCELED') {
        throw new MembershipPayloadError(
          `SUBSCRIPTION_CANCELED exige status CANCELED no payload (recebido: ${payload.status}).`,
        );
      }
      return 'CANCELED';
    case 'SUBSCRIPTION_EXPIRED':
      if (payload.status !== 'EXPIRED') {
        throw new MembershipPayloadError(
          `SUBSCRIPTION_EXPIRED exige status EXPIRED no payload (recebido: ${payload.status}).`,
        );
      }
      return 'EXPIRED';
  }
}

export type MembershipTransitionPlan =
  | { kind: 'applied'; status: MembershipStatus; currentPeriodEnd?: Date }
  | { kind: 'already-applied'; status: MembershipStatus }
  | {
      kind: 'ignored';
      reason: 'stale' | 'terminal';
      current: MembershipStatus;
      incoming: MembershipStatus;
    };

/**
 * Decide o efeito de um evento, dado o estado LOCAL. `applied` avança o estado;
 * `already-applied` e `ignored` são sucessos idempotentes (200), sem regredir.
 *
 * A RENOVAÇÃO é o único caso em que o status alvo é igual ao local e ainda assim
 * há efeito: o período avança e o ciclo novo é creditado. Um evento de renovação
 * com período que não avança é reentrega (already-applied), o que mantém a
 * concessão de crédito idempotente por construção.
 */
export function planMembershipTransition(
  local: Pick<LocalMembershipState, 'status' | 'currentPeriodEnd'>,
  incoming: MembershipStatus,
  options: { type: MembershipWebhookEventType; currentPeriodEnd?: Date },
): MembershipTransitionPlan {
  const nextPeriodEnd = options.currentPeriodEnd;

  if (local.status === incoming) {
    if (
      options.type === 'SUBSCRIPTION_CYCLE_RENEWED' &&
      nextPeriodEnd &&
      (!local.currentPeriodEnd || nextPeriodEnd.getTime() > local.currentPeriodEnd.getTime())
    ) {
      return { kind: 'applied', status: incoming, currentPeriodEnd: nextPeriodEnd };
    }
    return { kind: 'already-applied', status: incoming };
  }

  if (!canTransitionMembership(local.status, incoming)) {
    return {
      kind: 'ignored',
      reason: local.status === 'CANCELED' || local.status === 'EXPIRED' ? 'terminal' : 'stale',
      current: local.status,
      incoming,
    };
  }

  return {
    kind: 'applied',
    status: incoming,
    ...(nextPeriodEnd ? { currentPeriodEnd: nextPeriodEnd } : {}),
  };
}

// ---------------------------------------------------------------------------
// Política de créditos (consumida pela F5.2)
// ---------------------------------------------------------------------------

export type CancellationCreditDisposition =
  | 'USE_UNTIL_PERIOD_END_THEN_EXPIRE'
  | 'FORFEIT_NOW';

export type CancellationActor = 'CUSTOMER' | 'OWNER';

export interface CancellationCreditPolicy {
  /** Quem pediu o cancelamento. */
  actor: CancellationActor;
  /** Quando o cancelamento passa a valer. */
  effective: 'IMMEDIATE';
  /** O que acontece com os créditos não usados do ciclo já pago. */
  creditDisposition: CancellationCreditDisposition;
}

/**
 * DECISÃO DOCUMENTADA (fase 5, item 3/5). O ciclo já pago não é estornado: o
 * crédito não usado EXPIRA. No cancelamento comum (cliente ou dono), o assinante
 * mantém o acesso aos créditos do ciclo corrente até `currentPeriodEnd`; ele só
 * não renova. No cancelamento imediato por abuso/fraude (`immediate`), os
 * créditos são forfeitados na hora. A renovação credita o ciclo novo.
 */
export function resolveCancellationCreditPolicy(
  actor: CancellationActor,
  options: { immediate?: boolean } = {},
): CancellationCreditPolicy {
  return {
    actor,
    effective: 'IMMEDIATE',
    creditDisposition: options.immediate ? 'FORFEIT_NOW' : 'USE_UNTIL_PERIOD_END_THEN_EXPIRE',
  };
}

// ---------------------------------------------------------------------------
// Erros de domínio e visão
// ---------------------------------------------------------------------------

export type MembershipErrorCode =
  | 'INVALID_INPUT'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_INACTIVE'
  | 'UNSUPPORTED_CYCLE'
  | 'CUSTOMER_NOT_FOUND'
  | 'ACCOUNT_UNAVAILABLE'
  | 'ALREADY_SUBSCRIBED'
  | 'INVALID_REMOTE_IP'
  | 'INVALID_CARD'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROVIDER_ERROR'
  | 'PERSISTENCE_FAILED';

export class MembershipError extends Error {
  readonly code: MembershipErrorCode;

  constructor(code: MembershipErrorCode, message: string) {
    super(message);
    this.name = 'MembershipError';
    this.code = code;
  }
}

export interface MembershipView {
  id: string;
  tenantId: string;
  customerId: string;
  planId: string;
  planName: string;
  status: MembershipStatus;
  contractedPriceCents: number;
  currentPeriodEnd: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  asaasSubscriptionId: string | null;
}

export type SubscribeMembershipResult =
  | { ok: true; membership: MembershipView }
  | { ok: false; code: MembershipErrorCode; message: string };

export type CancelMembershipResult =
  | { ok: true; membership: MembershipView; policy: CancellationCreditPolicy }
  | { ok: false; code: MembershipErrorCode; message: string };

function fail(code: MembershipErrorCode, message: string): { ok: false; code: MembershipErrorCode; message: string } {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------------------
// Erro HTTP do webhook
// ---------------------------------------------------------------------------

export class MembershipWebhookError extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'MembershipWebhookError';
  }
}

export interface MembershipWebhookResult {
  status: 200;
  body: { received: boolean; duplicate?: boolean; applied?: string };
}

// ---------------------------------------------------------------------------
// remoteIp do pagador
// ---------------------------------------------------------------------------

/**
 * Extrai o IP do pagador dos headers de proxy/CDN, na mesma ordem do checkout da
 * F4.2 (`plano-refatoracao.md` §1.1). A ausência é `null` — quem chama trata,
 * nunca cai para o IP do servidor como fallback.
 */
export function extractPayerIpFromHeaders(
  headers: Pick<Headers, 'get'>,
): string | null {
  return (
    firstIpFromHeader(headers.get('x-forwarded-for')) ??
    firstIpFromHeader(headers.get('x-real-ip')) ??
    firstIpFromHeader(headers.get('cf-connecting-ip'))
  );
}

/**
 * Normaliza e valida o IP do pagador ANTES de chamar o provedor. Recusa ausente,
 * loopback e faixa privada. Em desenvolvimento, `resolvePayerIp` aceita
 * `DEV_PAYER_IP` como origem (a requisição local chega de loopback); em produção
 * a variável é ignorada e a regra é a do Asaas.
 */
export function resolvePublicPayerIp(remoteIp: string | null | undefined): string {
  const resolved = resolvePayerIp(remoteIp);
  if (!resolved || !isPublicIp(resolved)) {
    throw new MembershipError(
      'INVALID_REMOTE_IP',
      'Não foi possível identificar o IP do seu dispositivo. Tente novamente.',
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Cartão (apresentação)
// ---------------------------------------------------------------------------

/**
 * Marca do cartão a partir do BIN, só para a tela dizer qual cartão será
 * cobrado. O PAN nunca é persistido — apenas os quatro últimos dígitos.
 */
export function detectCardBrand(number: string): string | null {
  const digits = number.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MASTERCARD';
  if (/^3[47]/.test(digits)) return 'AMEX';
  if (/^(4011|4312|4389|5041|5067|509|6277|6363|6504|6516|6550)/.test(digits)) return 'ELO';
  if (/^(606282|3841)/.test(digits)) return 'HIPERCARD';
  if (/^(6011|65|64[4-9])/.test(digits)) return 'DISCOVER';
  return null;
}

export function lastFourDigits(number: string): string {
  return number.replace(/\D/g, '').slice(-4);
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

const MEMBERSHIP_VIEW_SELECT = {
  id: true,
  tenantId: true,
  customerId: true,
  planId: true,
  status: true,
  contractedPriceCents: true,
  currentPeriodEnd: true,
  cardBrand: true,
  cardLastFour: true,
  asaasSubscriptionId: true,
  plan: { select: { name: true } },
} satisfies Prisma.MembershipSelect;

type MembershipViewRow = Prisma.MembershipGetPayload<{ select: typeof MEMBERSHIP_VIEW_SELECT }>;

function toMembershipView(row: MembershipViewRow): MembershipView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    planId: row.planId,
    planName: row.plan.name,
    status: row.status as MembershipStatus,
    contractedPriceCents: row.contractedPriceCents,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    cardBrand: row.cardBrand,
    cardLastFour: row.cardLastFour,
    asaasSubscriptionId: row.asaasSubscriptionId,
  };
}

export async function getMembershipView(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
): Promise<MembershipView | null> {
  const row = await tx.membership.findFirst({
    where: { id: membershipId, tenantId },
    select: MEMBERSHIP_VIEW_SELECT,
  });
  return row ? toMembershipView(row) : null;
}

export async function listCustomerMemberships(
  tx: TenantTransaction,
  tenantId: string,
  customerId: string,
): Promise<MembershipView[]> {
  const rows = await tx.membership.findMany({
    where: { tenantId, customerId },
    orderBy: { createdAt: 'desc' },
    select: MEMBERSHIP_VIEW_SELECT,
  });
  return rows.map(toMembershipView);
}

// ---------------------------------------------------------------------------
// Assinatura
// ---------------------------------------------------------------------------

export interface MembershipCardInput {
  number: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface SubscribeMembershipInput {
  tenantId: string;
  /** `TenantMember.id` do assinante. */
  customerId: string;
  planId: string;
  card: MembershipCardInput;
  /** IP do dispositivo do pagador (obrigatório). */
  remoteIp?: string | null;
  /** Injetável em teste; o padrão é a factory por `PAYMENT_PROVIDER`. */
  provider?: PaymentProvider;
  now?: Date;
}

/**
 * Janela em que uma `Membership` com `asaasSubscriptionId` nulo é considerada
 * "claim em andamento" (não reutilizável). Passou disso, é resquício de uma
 * tentativa que morreu antes do provedor responder e pode ser reaproveitado.
 *
 * LIMITAÇÃO CONHECIDA. O claim nasce ANTES da chamada ao provedor (é o que
 * impede duas cobranças no duplo clique), então uma queda do processo entre o
 * insert e a resposta do provedor deixa uma linha com status ACTIVE e sem id de
 * assinatura. Ela não cobra ninguém e é reaproveitada após `CLAIM_STALE_MS`; o
 * preço/dado do claim antigo é o que o cliente aceitou naquele momento. Um índice
 * único parcial (`WHERE status = 'ACTIVE'`) ou um estado PENDING explícito seriam
 * melhores, mas mexem no schema congelado — decisão da F0, fora desta tarefa.
 */
const CLAIM_STALE_MS = 5 * 60_000;

/**
 * Chave do advisory lock que serializa a assinatura por (tenant, cliente, plano).
 * Sem índice único parcial (`WHERE status = 'ACTIVE'`, fora do schema por decisão
 * da F0), é isto que impede duas assinaturas ativas: a transação do claim trava
 * a chave, relê e só então cria.
 */
function membershipLockKey(tenantId: string, customerId: string, planId: string): string {
  return `membership:${tenantId}:${customerId}:${planId}`;
}

interface ClaimPlan {
  id: string;
  name: string;
  priceCents: number;
  cycle: MembershipCycle;
}

interface ClaimAccount {
  asaasAccountId: string;
  walletId: string;
}

interface SubscribeContext {
  plan: ClaimPlan;
  providerCycle: SubscriptionCycle;
  account: ClaimAccount;
  timezone: string;
}

type ClaimResult =
  | { ok: true; membershipId: string }
  | { ok: false; code: 'ALREADY_SUBSCRIBED' };

/**
 * Assina o plano do clube. Ordem: valida o IP, lê plano/cliente/conta, toma o
 * CLAIM local (advisory lock + insert sem id do provedor), chama o provedor FORA
 * da transação e persiste o id. Se o provedor recusar, o claim é removido — não
 * sobra assinatura fantasma no banco.
 *
 * O guard de duplicidade é o banco, não um `if` de tela: duplo clique ou
 * webhook reentregue viram DUAS cobranças recorrentes no cartão do cliente se a
 * checagem não for serializada. O teste de concorrência prova que só uma passa.
 */
export async function subscribeMembership(
  input: SubscribeMembershipInput,
): Promise<SubscribeMembershipResult> {
  const now = input.now ?? new Date();
  const provider = input.provider ?? getPaymentProvider();

  let remoteIp: string;
  try {
    remoteIp = resolvePublicPayerIp(input.remoteIp);
  } catch (error) {
    if (error instanceof MembershipError) return fail(error.code, error.message);
    throw error;
  }

  const context = await forTenant(input.tenantId, (tx) =>
    loadSubscribeContext(tx, input.tenantId, input.customerId, input.planId),
  );
  if ('error' in context) return fail(context.error, context.message);

  const { plan, providerCycle, account, timezone } = context;

  const claim = await forTenant(input.tenantId, (tx) =>
    claimMembership(
      tx,
      input.tenantId,
      input.customerId,
      input.planId,
      plan.priceCents,
      plan.cycle,
      now,
    ),
  );
  if (!claim.ok) {
    return fail(
      'ALREADY_SUBSCRIBED',
      'Você já tem uma assinatura ativa deste plano.',
    );
  }

  const membershipId = claim.membershipId;
  const nextDueDate = tenantDateString(now, timezone);

  // Duas transações ao redor do provedor, de propósito: até `createSubscription`
  // terminar, nada foi criado e o claim pode ser removido com segurança; depois
  // dele, a assinatura EXISTE no provedor e apagar o registro local deixaria uma
  // cobrança recorrente órfã no cartão do cliente. Erro de persistência depois
  // disso vira reconciliação, não deleção.
  let token: string;
  let subscriptionId: string;
  let subscriptionNextDueDate: string;
  try {
    const tokenized = await provider.tokenizeCard({
      // A tokenização também é na subconta: o token pertence ao cliente que o
      // originou e não pode ser reaproveitado por outro.
      accountId: account.asaasAccountId,
      customerId: input.customerId,
      number: input.card.number,
      holderName: input.card.holderName,
      expiryMonth: input.card.expiryMonth,
      expiryYear: input.card.expiryYear,
      ccv: input.card.ccv,
      remoteIp,
    });
    token = tokenized.token;

    const subscription = await provider.createSubscription({
      // SEMPRE a subconta do salão. O accountId não vem do chamador.
      accountId: account.asaasAccountId,
      customerId: input.customerId,
      planId: plan.id,
      // Preço CONGELADO no ato da assinatura.
      amountCents: plan.priceCents,
      cycle: providerCycle,
      nextDueDate,
      description: plan.name,
      cardToken: token,
      remoteIp,
      split: buildPlatformSplit(plan.priceCents),
      externalReference: membershipId,
    });
    subscriptionId = subscription.id;
    subscriptionNextDueDate = subscription.nextDueDate;
  } catch (error) {
    // Nada foi criado no provedor: desfaz o claim.
    await forTenant(input.tenantId, (tx) =>
      tx.membership.deleteMany({
        where: { id: membershipId, tenantId: input.tenantId, asaasSubscriptionId: null },
      }),
    );
    return mapProviderFailure(error);
  }

  try {
    const membership = await forTenant(input.tenantId, async (tx) => {
      const updated = await tx.membership.update({
        where: { id: membershipId },
        data: {
          asaasSubscriptionId: subscriptionId,
          cardToken: token,
          cardBrand: detectCardBrand(input.card.number),
          cardLastFour: lastFourDigits(input.card.number),
          status: 'ACTIVE',
          currentPeriodEnd: nextPeriodEnd(now, subscriptionNextDueDate, plan.cycle),
        },
        select: MEMBERSHIP_VIEW_SELECT,
      });
      return toMembershipView(updated);
    });

    return { ok: true, membership };
  } catch (error) {
    // A assinatura existe no provedor. O claim fica pendente (sem id do
    // provedor) para reconciliação; NÃO apagar.
    console.error('[membership] assinatura criada no provedor mas não persistida', {
      tenantId: input.tenantId,
      membershipId,
      subscriptionId,
      error,
    });
    return fail(
      'PERSISTENCE_FAILED',
      'A assinatura foi criada, mas não conseguimos registrar agora. Tente novamente em instantes.',
    );
  }
}

async function loadSubscribeContext(
  tx: TenantTransaction,
  tenantId: string,
  customerId: string,
  planId: string,
): Promise<SubscribeContext | { error: MembershipErrorCode; message: string }> {
  const plan = await tx.membershipPlan.findFirst({
    where: { id: planId, tenantId },
    select: { id: true, name: true, priceCents: true, cycle: true, active: true },
  });
  if (!plan) return { error: 'PLAN_NOT_FOUND', message: 'Plano do clube não encontrado.' };
  if (!plan.active) return { error: 'PLAN_INACTIVE', message: 'Este plano não está mais disponível.' };
  const providerCycle = providerCycleFor(plan.cycle as MembershipCycle);
  if (!providerCycle) {
    return {
      error: 'UNSUPPORTED_CYCLE',
      message: 'Este plano usa um ciclo de cobrança que o meio de pagamento ainda não suporta.',
    };
  }

  const customer = await tx.tenantMember.findFirst({
    where: { id: customerId, tenantId, role: 'CUSTOMER' },
    select: { id: true },
  });
  if (!customer) {
    return { error: 'CUSTOMER_NOT_FOUND', message: 'Cliente não encontrado neste estabelecimento.' };
  }

  const account = await tx.asaasAccount.findFirst({
    where: { tenantId },
    select: { asaasAccountId: true, walletId: true, kycStatus: true },
  });
  if (!account || account.kycStatus !== 'APPROVED') {
    return {
      error: 'ACCOUNT_UNAVAILABLE',
      message: 'O clube do estabelecimento não está com o recebimento ativo.',
    };
  }

  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  });

  return {
    plan: { id: plan.id, name: plan.name, priceCents: plan.priceCents, cycle: plan.cycle as MembershipCycle },
    providerCycle,
    account: { asaasAccountId: account.asaasAccountId, walletId: account.walletId },
    timezone: tenant?.timezone ?? 'America/Sao_Paulo',
  };
}

async function claimMembership(
  tx: TenantTransaction,
  tenantId: string,
  customerId: string,
  planId: string,
  contractedPriceCents: number,
  cycle: MembershipCycle,
  now: Date,
): Promise<ClaimResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${membershipLockKey(
    tenantId,
    customerId,
    planId,
  )}))`;

  const existing = await tx.membership.findFirst({
    where: { tenantId, customerId, planId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, asaasSubscriptionId: true, createdAt: true },
  });

  if (existing) {
    const inFlight = now.getTime() - existing.createdAt.getTime() < CLAIM_STALE_MS;
    // Claim em andamento (id do provedor ainda não gravado) também bloqueia: é
    // exatamente a janela de um duplo clique concorrente.
    if (existing.asaasSubscriptionId !== null || inFlight) {
      return { ok: false, code: 'ALREADY_SUBSCRIBED' };
    }
    // Resquício de tentativa que morreu antes do provedor: reusa a linha.
    return { ok: true, membershipId: existing.id };
  }

  const created = await tx.membership.create({
    data: {
      tenantId,
      customerId,
      planId,
      status: 'ACTIVE',
      contractedPriceCents,
      currentPeriodEnd: addCycle(now, cycle),
    },
    select: { id: true },
  });
  return { ok: true, membershipId: created.id };
}

// ---------------------------------------------------------------------------
// Cancelamento
// ---------------------------------------------------------------------------

export type MembershipCancelActor =
  | { kind: 'CUSTOMER'; memberId: string }
  | { kind: 'OWNER'; userId: string };

export interface CancelMembershipInput {
  tenantId: string;
  membershipId: string;
  actor: MembershipCancelActor;
  /** Cancelamento por abuso/fraude: forfeita os créditos na hora. */
  immediate?: boolean;
  provider?: PaymentProvider;
  now?: Date;
}

interface CancellableMembership {
  id: string;
  customerId: string;
  status: MembershipStatus;
  asaasSubscriptionId: string | null;
}

/**
 * Cancela a assinatura, pelo cliente ou pelo dono. O provedor é chamado FORA da
 * transação; só depois o estado local é reconciliado (idempotente com o webhook
 * `SUBSCRIPTION_CANCELED`). Não apaga histórico nem créditos: a política
 * devolvida diz à F5.2 o que fazer com o saldo do ciclo corrente.
 */
export async function cancelMembership(
  input: CancelMembershipInput,
): Promise<CancelMembershipResult> {
  const provider = input.provider ?? getPaymentProvider();

  const loaded = await forTenant(input.tenantId, (tx) =>
    loadCancellable(tx, input),
  );
  if ('error' in loaded) return fail(loaded.error, loaded.message);

  const { membership } = loaded;

  if (membership.status === 'CANCELED' || membership.status === 'EXPIRED') {
    const view = await forTenant(input.tenantId, (tx) =>
      getMembershipView(tx, input.tenantId, membership.id),
    );
    if (!view) {
      return fail('MEMBERSHIP_NOT_FOUND', 'Assinatura não encontrada.');
    }
    const policy = resolveCancellationCreditPolicy(input.actor.kind, {
      immediate: input.immediate,
    });
    return { ok: true, membership: view, policy };
  }

  if (membership.asaasSubscriptionId) {
    try {
      await provider.cancelSubscription(membership.asaasSubscriptionId);
    } catch (error) {
      if (!isAlreadyCanceled(error)) {
        return mapProviderFailure(error);
      }
    }
  }

  const view = await forTenant(input.tenantId, (tx) =>
    applyCancellation(tx, input.tenantId, membership.id),
  );
  const policy = resolveCancellationCreditPolicy(input.actor.kind, {
    immediate: input.immediate,
  });
  return { ok: true, membership: view, policy };
}

async function loadCancellable(
  tx: TenantTransaction,
  input: CancelMembershipInput,
): Promise<{ membership: CancellableMembership } | { error: MembershipErrorCode; message: string }> {
  const membership = await tx.membership.findFirst({
    where: { id: input.membershipId, tenantId: input.tenantId },
    select: { id: true, customerId: true, status: true, asaasSubscriptionId: true },
  });
  if (!membership) {
    return { error: 'MEMBERSHIP_NOT_FOUND', message: 'Assinatura não encontrada.' };
  }

  if (input.actor.kind === 'CUSTOMER') {
    if (membership.customerId !== input.actor.memberId) {
      return { error: 'FORBIDDEN', message: 'Esta assinatura pertence a outro cliente.' };
    }
  } else {
    const owner = await tx.tenantMember.findFirst({
      where: { tenantId: input.tenantId, userId: input.actor.userId, role: 'OWNER' },
      select: { id: true },
    });
    if (!owner) {
      return { error: 'FORBIDDEN', message: 'Apenas o dono do estabelecimento pode cancelar.' };
    }
  }

  return {
    membership: {
      id: membership.id,
      customerId: membership.customerId,
      status: membership.status as MembershipStatus,
      asaasSubscriptionId: membership.asaasSubscriptionId,
    },
  };
}

async function applyCancellation(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
): Promise<MembershipView> {
  // Trava a linha antes de decidir; a transição em si é idempotente.
  await tx.$queryRaw`SELECT id FROM membership WHERE id = ${membershipId} FOR UPDATE`;

  const current = await tx.membership.findFirst({
    where: { id: membershipId, tenantId },
    select: { status: true },
  });
  const status = current?.status as MembershipStatus | undefined;
  if (status && status !== 'CANCELED' && status !== 'EXPIRED') {
    await tx.membership.update({ where: { id: membershipId }, data: { status: 'CANCELED' } });
  }

  const view = await getMembershipView(tx, tenantId, membershipId);
  if (!view) throw new MembershipError('MEMBERSHIP_NOT_FOUND', 'Assinatura não encontrada.');
  return view;
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export interface ProcessMembershipWebhookOptions {
  now?: Date;
}

/**
 * Processa um evento de assinatura do clube. O evento pressupõe autenticação JÁ
 * verificada pela rota — nunca chame isto a partir de entrada não verificada.
 *
 * IDEMPOTÊNCIA: o `WebhookEvent` é a PRIMEIRA escrita da transação. Reentrega
 * viola a unique (provider, eventId), a transação desfaz e a resposta é 200
 * `duplicate` sem reprocessar. Se o processamento falhar depois, a transação
 * inteira desfaz — inclusive o insert — e a reentrega consegue processar.
 */
export async function processMembershipWebhook(
  event: MembershipWebhookEvent,
  rawBody: string,
  options: ProcessMembershipWebhookOptions = {},
): Promise<MembershipWebhookResult> {
  const now = options.now ?? new Date();
  const payload = event.data.subscription;
  if (!payload) {
    throw new MembershipWebhookError(400, 'Evento de assinatura sem dados da assinatura.');
  }

  const tenantId = await resolveTenantForMembership(payload);
  if (!tenantId) {
    throw new MembershipWebhookError(404, 'Assinatura desconhecida para o evento recebido.');
  }

  try {
    return await forTenant(tenantId, (tx) =>
      processMembershipInTransaction(tx, tenantId, event, rawBody, now),
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    throw error;
  }
}

/** Resolve, em leitura e sob RLS, a qual tenant a assinatura pertence. */
async function resolveTenantForMembership(
  payload: MembershipWebhookSubscriptionData,
): Promise<string | null> {
  const tenantIds = await listAllTenantIds();

  for (const tenantId of tenantIds) {
    const found = await forTenant(tenantId, async (tx) => {
      // `membershipId` é o `externalReference` da assinatura e é um cuid único:
      // resolve o tenant sem depender de o id do provedor ser globalmente único
      // (no mock ele é sequencial por store e dois processos podem coincidir).
      const row = await tx.membership.findFirst({
        where: { tenantId, id: payload.membershipId },
        select: { id: true },
      });
      return row !== null;
    });
    if (found) return tenantId;
  }

  return null;
}

async function processMembershipInTransaction(
  tx: TenantTransaction,
  tenantId: string,
  event: MembershipWebhookEvent,
  rawBody: string,
  now: Date,
): Promise<MembershipWebhookResult> {
  const eventRow = await tx.webhookEvent.create({
    data: {
      provider: event.provider,
      eventId: event.eventId,
      payload: parseRawPayload(rawBody, event),
    },
    select: { id: true },
  });

  const applied = await applyMembershipEvent(tx, tenantId, event);

  await tx.webhookEvent.update({
    where: { id: eventRow.id },
    data: { processedAt: now },
  });

  return { status: 200, body: { received: true, applied: applied.description } };
}

interface AppliedEffect {
  description: string;
}

async function applyMembershipEvent(
  tx: TenantTransaction,
  tenantId: string,
  event: MembershipWebhookEvent,
): Promise<AppliedEffect> {
  const payload = event.data.subscription;
  if (!payload) {
    throw new MembershipWebhookError(400, 'Evento de assinatura sem dados da assinatura.');
  }

  const local = await tx.membership.findFirst({
    where: { tenantId, id: payload.membershipId },
    select: {
      id: true,
      planId: true,
      status: true,
      contractedPriceCents: true,
      asaasSubscriptionId: true,
      currentPeriodEnd: true,
    },
  });
  if (!local) {
    throw new MembershipWebhookError(404, 'Assinatura não encontrada no tenant do evento.');
  }

  // Trava a linha antes de decidir, para dois eventos concorrentes (renovação e
  // falha) não lerem o mesmo estado e o último commit regredir.
  await tx.$queryRaw`SELECT id FROM membership WHERE id = ${local.id} FOR UPDATE`;

  const locked = await tx.membership.findFirst({
    where: { id: local.id },
    select: {
      id: true,
      planId: true,
      status: true,
      contractedPriceCents: true,
      asaasSubscriptionId: true,
      currentPeriodEnd: true,
    },
  });
  if (!locked) {
    throw new MembershipWebhookError(404, 'Assinatura não encontrada no tenant do evento.');
  }

  const state: LocalMembershipState = {
    id: locked.id,
    planId: locked.planId,
    status: locked.status as MembershipStatus,
    contractedPriceCents: locked.contractedPriceCents,
    asaasSubscriptionId: locked.asaasSubscriptionId,
    currentPeriodEnd: locked.currentPeriodEnd,
  };

  let incoming: MembershipStatus;
  try {
    validateMembershipPayload(state, payload);
    incoming = incomingStatusForMembershipEvent(event.type, payload);
  } catch (error) {
    if (error instanceof MembershipPayloadError) {
      throw new MembershipWebhookError(400, error.message);
    }
    throw error;
  }

  const plan = planMembershipTransition(state, incoming, {
    type: event.type,
    currentPeriodEnd: new Date(payload.currentPeriodEnd),
  });

  if (plan.kind === 'ignored') {
    return {
      description: `membership:${state.id}:ignored:${plan.reason}`,
    };
  }

  if (plan.kind === 'applied') {
    await tx.membership.update({
      where: { id: state.id },
      data: {
        status: plan.status,
        ...(plan.currentPeriodEnd ? { currentPeriodEnd: plan.currentPeriodEnd } : {}),
      },
    });
    return { description: `membership:${state.id}:${plan.status}` };
  }

  return { description: `membership:${state.id}:${plan.status}:already` };
}

/** Parse do corpo cru. Recusa o que não for evento de assinatura válido. */
export function parseMembershipWebhookEvent(rawBody: string): MembershipWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (typeof parsed.provider !== 'string' || parsed.provider.length === 0) return null;
  if (typeof parsed.eventId !== 'string' || parsed.eventId.length === 0) return null;
  if (
    typeof parsed.type !== 'string' ||
    !(MEMBERSHIP_WEBHOOK_EVENT_TYPES as readonly string[]).includes(parsed.type)
  ) {
    return null;
  }
  if (typeof parsed.occurredAt !== 'string' || parsed.occurredAt.length === 0) return null;
  if (!isRecord(parsed.data)) return null;
  if (!isMembershipSubscriptionData(parsed.data.subscription)) return null;

  return parsed as unknown as MembershipWebhookEvent;
}

function isMembershipSubscriptionData(value: unknown): value is MembershipWebhookSubscriptionData {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.accountId === 'string' &&
    typeof value.customerId === 'string' &&
    typeof value.planId === 'string' &&
    typeof value.membershipId === 'string' &&
    isMembershipStatus(value.status) &&
    typeof value.amountCents === 'number' &&
    Number.isInteger(value.amountCents) &&
    typeof value.currentPeriodEnd === 'string' &&
    !Number.isNaN(new Date(value.currentPeriodEnd).getTime())
  );
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Taxa da plataforma, arredondada UMA vez, em centavos (fonte única: F4.2). */
function buildPlatformSplit(amountCents: number): Split[] {
  return [{ walletId: getPlatformWalletId(), fixedValueCents: computePlatformFeeCents(amountCents) }];
}

function addCycle(date: Date, cycle: MembershipCycle | null): Date {
  const months = cycle ? (CYCLE_MONTHS[cycle] ?? 1) : 1;
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * Fim do ciclo a partir do vencimento que o provedor devolveu. O vencimento é
 * uma data de calendário do tenant; somar o ciclo dá o fim do período pago.
 * Se o formato vier inesperado, cai para `now + ciclo` em vez de gravar data
 * inválida.
 */
function nextPeriodEnd(fallback: Date, nextDueDate: string, cycle: MembershipCycle): Date {
  const base = new Date(`${nextDueDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return addCycle(fallback, cycle);
  return addCycle(base, cycle);
}

function mapProviderFailure(error: unknown): { ok: false; code: MembershipErrorCode; message: string } {
  if (error instanceof MembershipError) return fail(error.code, error.message);
  if (error instanceof PaymentProviderError) {
    switch (error.code) {
      case 'KYC_NOT_APPROVED':
      case 'ACCOUNT_NOT_FOUND':
        return fail('ACCOUNT_UNAVAILABLE', 'O recebimento do estabelecimento não está ativo.');
      case 'REMOTE_IP_REQUIRED':
      case 'REMOTE_IP_NOT_PUBLIC':
        return fail('INVALID_REMOTE_IP', 'Não foi possível validar o IP do seu dispositivo.');
      case 'INVALID_CARD':
      case 'CARD_DATA_REQUIRED':
      case 'CARD_TOKEN_INVALID':
        return fail('INVALID_CARD', 'Os dados do cartão não foram aceitos.');
      case 'SPLIT_TO_SELF':
      case 'INVALID_SPLIT':
        return fail(
          'PROVIDER_ERROR',
          'A configuração de recebimento do clube está incorreta. Avise o estabelecimento.',
        );
      default:
        return fail('PROVIDER_ERROR', 'Não foi possível concluir a assinatura agora.');
    }
  }
  return fail('PROVIDER_ERROR', 'Não foi possível concluir a assinatura agora.');
}

function isAlreadyCanceled(error: unknown): boolean {
  return (
    error instanceof PaymentProviderError &&
    (error.code === 'SUBSCRIPTION_NOT_ACTIVE' || error.code === 'SUBSCRIPTION_NOT_FOUND')
  );
}

function parseRawPayload(rawBody: string, event: MembershipWebhookEvent): Prisma.InputJsonValue {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (isRecord(parsed)) return parsed as Prisma.InputJsonValue;
  } catch {
    // Corpo não-JSON já foi recusado pelo parser; defesa extra.
  }
  return event as unknown as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return meta?.code === 'P2002' || meta?.code === '23505';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
