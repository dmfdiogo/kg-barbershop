import type { TenantTransaction } from '@/lib/tenant/db';
import {
  BILLING_PLANS,
  getBillingPlan,
  nextUpgrade,
  planDirection,
  type BillingPlanCode,
  type PlanDirection,
} from './plans';

/**
 * Planos, limites e *enforcement* no servidor (tarefa F7.0).
 *
 * Duas regras não negociáveis:
 *
 * 1. **O limite vale na chamada direta.** Esconder o botão no front não é
 *    limite — quem chama a server action / o núcleo de dados por fora da tela
 *    tem de esbarrar na mesma checagem. É por isso que a checagem vive aqui,
 *    recebe a transação e é chamada de dentro de `inviteStaff`, e não na UI.
 * 2. **Downgrade com uso acima do limite não aplica sem decisão.** A troca de
 *    plano devolve a lista de agendas ativas e exige que o dono escolha quem
 *    desativar; sem essa escolha, nada é gravado. Nunca desativamos ninguém no
 *    escuro para "fazer o plano caber".
 *
 * `changePlan` mexe só no estado local (`PlatformSub.plan`) — é reexecutável e
 * vive no banco, como manda o contrato do client escopado. A troca no provedor
 * (proração) é responsabilidade da F7.2, FORA da transação: chamada externa
 * dentro de callback que pode rodar duas vezes existe para duplicar cobrança.
 */

/** Plano `null` = tenant em trial, sem `PlatformSub` ou ainda `TRIALING`. */
export interface AgendaUsage {
  plan: BillingPlanCode | null;
  planName: string;
  activeAgendas: number;
  /** `null` = ilimitado. */
  limit: number | null;
}

export interface ActiveAgenda {
  id: string;
  name: string;
}

export interface AgendaUpgrade {
  plan: BillingPlanCode;
  planName: string;
  priceCents: number;
  agendaLimit: number | null;
  /** Impacto em uma frase, pronto para a tela. */
  reason: string;
}

export type AddAgendaDecision =
  | { ok: true; usage: AgendaUsage }
  | {
      ok: false;
      code: 'PLAN_AGENDA_LIMIT';
      message: string;
      usage: AgendaUsage;
      upgrade?: AgendaUpgrade;
    };

/**
 * Uso de agendas do tenant. As consultas são SEQUENCIAIS de propósito: o
 * adapter-pg não gosta de queries concorrentes na mesma transação interativa
 * (nota em `lib/tenant/db.ts`).
 */
export async function getAgendaUsage(
  tx: TenantTransaction,
  tenantId: string,
): Promise<AgendaUsage> {
  const subscription = await tx.platformSub.findUnique({
    where: { tenantId },
    select: { plan: true, status: true },
  });
  const activeAgendas = await tx.staffProfile.count({
    where: { tenantId, active: true },
  });

  // Trial dá acesso pleno: o limite de agenda só vale depois que o tenant
  // escolhe um plano (a trial do produto é por valor, F7.1).
  const enforced = subscription !== null && subscription.status !== 'TRIALING';
  const plan = subscription?.plan ?? null;

  return {
    plan,
    planName: plan ? BILLING_PLANS[plan].name : 'Trial',
    activeAgendas,
    limit: enforced && plan ? getBillingPlan(plan).agendaLimit : null,
  };
}

/** Agendas ativas, para a tela de decisão do downgrade. */
export async function listActiveAgendas(
  tx: TenantTransaction,
  tenantId: string,
): Promise<ActiveAgenda[]> {
  const profiles = await tx.staffProfile.findMany({
    where: { tenantId, active: true },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      tenantMember: { select: { user: { select: { name: true } } } },
    },
  });
  return profiles.map((profile) => ({
    id: profile.id,
    name: profile.tenantMember.user.name,
  }));
}

/**
 * Portão do servidor para criar uma agenda nova. Chamado de dentro da
 * transação de `inviteStaff`; não decide nada no front.
 */
export async function assertCanAddAgenda(
  tx: TenantTransaction,
  tenantId: string,
): Promise<AddAgendaDecision> {
  const usage = await getAgendaUsage(tx, tenantId);

  if (usage.limit === null || usage.activeAgendas < usage.limit) {
    return { ok: true, usage };
  }

  const next = nextUpgrade(usage.plan);
  const upgrade: AgendaUpgrade | undefined = next
    ? {
        plan: next.code,
        planName: next.name,
        priceCents: next.priceCents,
        agendaLimit: next.agendaLimit,
        reason: next.agendaLimit === null
          ? `O plano ${next.name} libera agendas ilimitadas por ${formatBRL(next.priceCents)}/mês.`
          : `O plano ${next.name} libera até ${next.agendaLimit} agendas por ${formatBRL(next.priceCents)}/mês.`,
      }
    : undefined;

  const limitLabel = usage.limit === 1 ? '1 agenda ativa' : `${usage.limit} agendas ativas`;
  const message = upgrade
    ? `O plano ${usage.planName} permite ${limitLabel} e você já usa ${usage.activeAgendas}. Faça upgrade para o ${upgrade.planName} (${formatBRL(upgrade.priceCents)}/mês) para adicionar mais.`
    : `O plano ${usage.planName} permite ${limitLabel}.`;

  return {
    ok: false,
    code: 'PLAN_AGENDA_LIMIT',
    message,
    usage,
    ...(upgrade ? { upgrade } : {}),
  };
}

export interface PlanChangeAssessment {
  currentPlan: BillingPlanCode | null;
  nextPlan: BillingPlanCode;
  direction: PlanDirection;
  activeAgendas: number;
  nextLimit: number | null;
  /** Quantas agendas excedem o limite do plano de destino. */
  excess: number;
  /** `true` quando o downgrade aperta o limite e o dono precisa decidir. */
  requiresDecision: boolean;
  /** Agendas ativas entre as quais o dono escolhe — só quando há decisão. */
  agendas: ActiveAgenda[];
}

export async function assessPlanChange(
  tx: TenantTransaction,
  tenantId: string,
  nextPlan: BillingPlanCode,
): Promise<PlanChangeAssessment> {
  const usage = await getAgendaUsage(tx, tenantId);
  const nextLimit = getBillingPlan(nextPlan).agendaLimit;
  const excess = nextLimit === null ? 0 : Math.max(usage.activeAgendas - nextLimit, 0);
  const requiresDecision = excess > 0;

  return {
    currentPlan: usage.plan,
    nextPlan,
    direction: planDirection(usage.plan, nextPlan),
    activeAgendas: usage.activeAgendas,
    nextLimit,
    excess,
    requiresDecision,
    agendas: requiresDecision ? await listActiveAgendas(tx, tenantId) : [],
  };
}

export interface ChangePlanOptions {
  /**
   * Decisão explícita do dono: ids de `StaffProfile` a desativar. Precisa
   * cobrir o excesso; ids de outro tenant são ignorados pela query escopada.
   */
  deactivateStaffIds?: readonly string[];
}

export type PlanChangeResult =
  | { ok: true; plan: BillingPlanCode; deactivatedStaffIds: string[] }
  | {
      ok: false;
      code:
        | 'NO_SUBSCRIPTION'
        | 'SAME_PLAN'
        | 'DOWNGRADE_REQUIRES_DECISION'
        | 'INVALID_DEACTIVATION';
      message: string;
      assessment: PlanChangeAssessment;
    };

/**
 * Aplica a troca de plano localmente. Em downgrade que ultrapassa o limite do
 * destino, só aplica se `deactivateStaffIds` cobrir o excesso; caso contrário
 * devolve `DOWNGRADE_REQUIRES_DECISION` e NÃO grava nada.
 *
 * A sincronização com o provedor (proração) fica para a F7.2, fora do banco.
 */
export async function changePlan(
  tx: TenantTransaction,
  tenantId: string,
  nextPlan: BillingPlanCode,
  options: ChangePlanOptions = {},
): Promise<PlanChangeResult> {
  const existing = await tx.platformSub.findUnique({
    where: { tenantId },
    select: { plan: true },
  });

  const assessment = await assessPlanChange(tx, tenantId, nextPlan);

  if (!existing) {
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
      message: `O tenant já está no plano ${BILLING_PLANS[nextPlan].name}.`,
      assessment,
    };
  }

  const requested = [...new Set(options.deactivateStaffIds ?? [])];
  let deactivatedStaffIds: string[] = [];

  if (assessment.requiresDecision) {
    const eligible =
      requested.length > 0
        ? await tx.staffProfile.findMany({
            where: { tenantId, active: true, id: { in: requested } },
            select: { id: true },
          })
        : [];

    if (eligible.length < assessment.excess) {
      return {
        ok: false,
        code:
          requested.length === 0 ? 'DOWNGRADE_REQUIRES_DECISION' : 'INVALID_DEACTIVATION',
        message:
          `O plano ${BILLING_PLANS[nextPlan].name} permite ` +
          `${assessment.nextLimit === null ? 'agendas ilimitadas' : `${assessment.nextLimit} agendas ativas`} ` +
          `e o salão tem ${assessment.activeAgendas}. Desative ${assessment.excess} antes de aplicar — ` +
          'agenda nenhuma é desligada no escuro.',
        assessment,
      };
    }

    deactivatedStaffIds = eligible.map((profile) => profile.id);
    await tx.staffProfile.updateMany({
      where: { tenantId, id: { in: deactivatedStaffIds }, active: true },
      data: { active: false },
    });
  }

  await tx.platformSub.update({ where: { tenantId }, data: { plan: nextPlan } });

  return { ok: true, plan: nextPlan, deactivatedStaffIds };
}

/** Preço em centavos → "R$ 39,90". Mantém a formatação em um lugar só. */
export function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
