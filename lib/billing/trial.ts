import type { TenantTransaction } from '@/lib/tenant/db';
import { BILLING_PLANS, nextUpgrade, type BillingPlanDefinition } from './plans';

/**
 * Trial por valor: os 10 primeiros agendamentos reais (tarefa F7.1, spec §6.2).
 *
 * A trial do produto NÃO é por prazo — é por valor entregue. O contador
 * (`Tenant.trialBookingsUsed`) só sobe quando um agendamento é CONFIRMADO, nunca
 * na criação do hold: um hold abandonado não pode consumir trial de graça.
 * Quem incrementa é o participante de transação
 * (`lib/booking/participants/trial-counter.ts`), que roda dentro da confirmação
 * e é reexecutável sob retry do client escopado — o rollback desfaz o incremento
 * e o retry o reaplica uma única vez.
 *
 * Duas regras de produto que moram aqui:
 *
 * 1. **Bloqueio gracioso no 11º.** Ao esgotar os 10, novos agendamentos são
 *    bloqueados, mas NADA que já existe é apagado ou escondido. Derrubar a
 *    agenda de um salão em funcionamento perderia o cliente e criaria problema
 *    para o consumidor final. O portão é `assertTrialAllowsNewBooking`, chamado
 *    na CRIAÇÃO do hold (`lib/booking/hold.ts`) — não na confirmação, para que o
 *    11º agendamento nem chegue a existir.
 *
 * 2. **Remarcação não consome trial.** Remarcar é o MESMO agendamento em outro
 *    horário; a F3.4 já decide não rodar participantes na remarcação
 *    (`lib/booking/reschedule.ts`). O portão só vive em `createHold`, nunca em
 *    `createHoldInTransaction`, que é o que a remarcação usa — assim remarcar um
 *    agendamento existente continua funcionando mesmo com a trial esgotada.
 *
 * DECISÃO — agendamento cancelado desconta trial? **Não.** O contador mede valor
 * entregue: um cancelamento ocorrido antes do atendimento não foi valor nenhum.
 * Não descontamos nada por cancelamento (nem os feitos pelo salão, nem os feitos
 * pelo cliente): recontar o passado exigiria decidir, a cada cancelamento, se o
 * horário chegou a ser ocupado, e um contador que anda para trás é uma fonte de
 * disputa com o dono ("eu já tinha usado 7"). O que conta é a confirmação; o
 * que foi cancelado depois não muda o fato de a confirmação ter acontecido.
 * Quando a cobrança por consumo entrar em cena, ela terá a própria fonte — o
 * `Payment` da F4 — e não o contador de trial.
 *
 * Um tenant que já escolheu plano (existe `PlatformSub` fora de `TRIALING`) está
 * FORA da trial: o contador para de subir e o portão não se aplica. A
 * inadimplência é assunto da F7.2, com o próprio fluxo de suspensão.
 */

/** Agendamentos gratuitos da trial (spec §6.2). */
export const TRIAL_BOOKING_LIMIT = 10;

/** A partir daqui o painel convida o dono a escolher um plano (spec §6.2). */
export const TRIAL_WARNING_AT = 8;

export type TrialPhase = 'TRIAL' | 'WARNING' | 'EXHAUSTED' | 'CONVERTED';

export interface TrialUpgradeSuggestion {
  code: BillingPlanDefinition['code'];
  name: string;
  priceCents: number;
  agendaLimit: number | null;
}

export interface TrialStatus {
  used: number;
  limit: number;
  /** Agendamentos gratuitos restantes; 0 quando esgotado. */
  remaining: number;
  phase: TrialPhase;
  /** `true` quando o tenant já escolheu plano (fora da trial). */
  converted: boolean;
  /**
   * Mensagem amigável para o painel; `null` quando não há nada a avisar
   * (trial no começo ou já convertido).
   */
  message: string | null;
  /** Sugestão de plano para o CTA do aviso; `null` quando já convertido. */
  upgrade: TrialUpgradeSuggestion | null;
}

/**
 * Erro de domínio do portão de trial. Lançado ao tentar criar um agendamento
 * novo com a trial esgotada. `status` 402 (Payment Required) porque a saída é
 * escolher um plano, não corrigir a requisição.
 */
export class TrialLimitError extends Error {
  readonly code = 'TRIAL_LIMIT_REACHED' as const;
  readonly status = 402;
  readonly trial: TrialStatus;

  constructor(trial: TrialStatus) {
    super(
      trial.message ??
        `Os ${trial.limit} agendamentos gratuitos do trial foram usados. Escolha um plano para receber novos agendamentos.`,
    );
    this.name = 'TrialLimitError';
    this.trial = trial;
  }
}

/**
 * Um tenant está fora da trial quando existe `PlatformSub` e seu status não é
 * `TRIALING`. Mesma linha de corte de `lib/billing/limits.ts`: a assinatura de
 * cobrança em trial do provedor ainda é trial do produto.
 */
function isConverted(status: string | undefined | null): boolean {
  return status !== undefined && status !== null && status !== 'TRIALING';
}

function suggestionFor(code: BillingPlanDefinition['code'] | null): TrialUpgradeSuggestion {
  const plan = nextUpgrade(code) ?? BILLING_PLANS[code ?? 'SOLO'];
  return {
    code: plan.code,
    name: plan.name,
    priceCents: plan.priceCents,
    agendaLimit: plan.agendaLimit,
  };
}

function messageFor(phase: TrialPhase, used: number, limit: number): string | null {
  if (phase === 'WARNING') {
    const remaining = limit - used;
    return (
      `Você já usou ${used} dos ${limit} agendamentos gratuitos. ` +
      `Restam ${remaining} ${remaining === 1 ? 'agendamento' : 'agendamentos'} no trial — ` +
      'escolha um plano para não interromper os próximos.'
    );
  }
  if (phase === 'EXHAUSTED') {
    return (
      `Você usou os ${limit} agendamentos gratuitos do trial. ` +
      'Seus agendamentos e sua agenda continuam disponíveis; ' +
      'para receber novos agendamentos, escolha um plano.'
    );
  }
  return null;
}

/**
 * Estado da trial do tenant. Duas leituras sequenciais — o adapter-pg do
 * Prisma não gosta de queries concorrentes na mesma transação interativa
 * (nota em `lib/tenant/db.ts`). Puro o bastante para alimentar o banner do
 * painel e o portão do servidor com a MESMA decisão.
 */
export async function getTrialStatus(
  tx: TenantTransaction,
  tenantId: string,
): Promise<TrialStatus> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { trialBookingsUsed: true },
  });
  const subscription = await tx.platformSub.findUnique({
    where: { tenantId },
    select: { plan: true, status: true },
  });

  const used = tenant.trialBookingsUsed;
  const converted = isConverted(subscription?.status);
  const limit = TRIAL_BOOKING_LIMIT;
  const remaining = Math.max(limit - used, 0);

  let phase: TrialPhase;
  if (converted) phase = 'CONVERTED';
  else if (used >= limit) phase = 'EXHAUSTED';
  else if (used >= TRIAL_WARNING_AT) phase = 'WARNING';
  else phase = 'TRIAL';

  return {
    used,
    limit,
    remaining,
    phase,
    converted,
    message: messageFor(phase, used, limit),
    upgrade: converted ? null : suggestionFor(subscription?.plan ?? null),
  };
}

/**
 * Corpo do participante de transação: incrementa o contador da trial, uma vez
 * por confirmação, enquanto o tenant ainda está na trial.
 *
 * REENTRÂNCIA: o incremento é um `UPDATE ... SET + 1` atômico no banco. A
 * transação que sofre retry (P2034) é desfeita por inteiro, incremento incluso,
 * e reaplicada — resultado líquido: 1. Não há contagem em memória, e o mesmo
 * agendamento não confirma duas vezes (a segunda chamada esbarra em
 * `INVALID_STATE` antes de qualquer participante rodar).
 */
export async function countTrialBooking(
  tx: TenantTransaction,
  tenantId: string,
): Promise<boolean> {
  const subscription = await tx.platformSub.findUnique({
    where: { tenantId },
    select: { status: true },
  });
  if (isConverted(subscription?.status)) return false;

  await tx.tenant.update({
    where: { id: tenantId },
    data: { trialBookingsUsed: { increment: 1 } },
  });
  return true;
}

/**
 * Portão de criação de agendamento novo. Chamado por `createHold` — a porta de
 * entrada de todo agendamento (portal e walk-in) — DENTRO da mesma transação do
 * hold, para que a decisão e a inserção enxerguem o mesmo estado.
 *
 * Só bloqueia quando a trial está `EXHAUSTED`. Tenant convertido passa; tenant
 * com agendamento existente continua acessando tudo (o portão não toca leitura
 * nem estado, só recusa a CRIAÇÃO). A remarcação não chama isto (usa
 * `createHoldInTransaction` direto), então mover um horário existente segue
 * permitido.
 */
export async function assertTrialAllowsNewBooking(
  tx: TenantTransaction,
  tenantId: string,
): Promise<TrialStatus> {
  const status = await getTrialStatus(tx, tenantId);
  if (status.phase === 'EXHAUSTED') {
    throw new TrialLimitError(status);
  }
  return status;
}
