import type { BillingPlan } from '@prisma/client';

/**
 * Catálogo de planos B2B (tarefa F7.0; spec-executiva.md §6.1).
 *
 * Preço e limite moram AQUI, nunca espalhados pelo código de produto. O
 * *enforcement* de limite (`./limits.ts`) e a cobrança (`BillingProvider`) leem
 * desta tabela; uma mudança de preço é uma linha, não uma caça ao literal.
 *
 * Dinheiro é sempre `Int` em centavos (`contexto-comum.md` §3.1). "Agenda" é um
 * profissional ativo (`StaffProfile.active`) — cada um tem a sua própria agenda.
 *
 * Módulo puro: não importa Prisma em runtime (só o tipo, apagado na compilação)
 * nem `next/headers`, então pode ser lido por server action e por testes.
 */

/** Mesmos valores do enum `BillingPlan` do schema — o tipo garante a paridade. */
export type BillingPlanCode = BillingPlan;

export interface BillingPlanDefinition {
  code: BillingPlanCode;
  /** Rótulo pt-BR exibido na interface. */
  name: string;
  /** Mensalidade em centavos. */
  priceCents: number;
  /** Agendas ativas permitidas; `null` = ilimitadas. */
  agendaLimit: number | null;
  /** Logo e customização de cores no portal. */
  branding: boolean;
  /** Domínio próprio (spec §5.2). */
  customDomain: boolean;
}

/** Ordem crescente de capacidade — a base para decidir upgrade × downgrade. */
export const BILLING_PLAN_CODES = ['SOLO', 'EQUIPE', 'PRO'] as const;

export const BILLING_PLANS: Record<BillingPlanCode, BillingPlanDefinition> = {
  SOLO: {
    code: 'SOLO',
    name: 'Solo',
    priceCents: 3990,
    agendaLimit: 1,
    branding: false,
    customDomain: false,
  },
  EQUIPE: {
    code: 'EQUIPE',
    name: 'Equipe',
    priceCents: 7990,
    agendaLimit: 4,
    branding: true,
    customDomain: false,
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    priceCents: 13990,
    agendaLimit: null,
    branding: true,
    customDomain: true,
  },
};

export function isBillingPlanCode(value: unknown): value is BillingPlanCode {
  return (
    typeof value === 'string' && (BILLING_PLAN_CODES as readonly string[]).includes(value)
  );
}

export function getBillingPlan(code: BillingPlanCode): BillingPlanDefinition {
  return BILLING_PLANS[code];
}

/** Posição na escada de planos; maior = mais capacidade. */
export function planRank(code: BillingPlanCode): number {
  return BILLING_PLAN_CODES.indexOf(code);
}

export type PlanDirection = 'UPGRADE' | 'DOWNGRADE' | 'SAME';

export function planDirection(
  current: BillingPlanCode | null,
  next: BillingPlanCode,
): PlanDirection {
  if (current === null) return 'UPGRADE';
  const delta = planRank(next) - planRank(current);
  if (delta === 0) return 'SAME';
  return delta > 0 ? 'UPGRADE' : 'DOWNGRADE';
}

/** Planos acima do informado, do mais barato ao mais caro. */
export function upgradeOptions(current: BillingPlanCode | null): BillingPlanDefinition[] {
  const floor = current === null ? -1 : planRank(current);
  return BILLING_PLAN_CODES.slice(floor + 1).map((code) => BILLING_PLANS[code]);
}

/** Primeiro plano com mais capacidade de agenda; `undefined` no topo. */
export function nextUpgrade(current: BillingPlanCode | null): BillingPlanDefinition | undefined {
  return upgradeOptions(current).find(
    (plan) =>
      current === null ||
      plan.agendaLimit === null ||
      (getBillingPlan(current).agendaLimit !== null &&
        plan.agendaLimit > getBillingPlan(current).agendaLimit!),
  );
}
