import type { KycStatus, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { BILLING_PLANS, type BillingPlanCode } from '@/lib/billing/plans';

/**
 * Números do negócio do painel da plataforma (tarefa F7.3).
 *
 * Módulo PURO de propósito: sem banco, sem `next/headers`, sem Prisma em
 * runtime (só tipos, apagados na compilação). É onde mora a aritmética que erra
 * fácil — quem entra no denominador do churn, do MRR e da conversão — e por
 * isso precisa ser testável sem subir Postgres. A leitura que alimenta estas
 * funções vive em `./overview.ts`.
 */

/** Uma linha do diretório, já normalizada para a tela (sem shape cru do Prisma). */
export interface PlatformTenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  createdAt: Date;
  plan: BillingPlanCode | null;
  subscriptionStatus: SubscriptionStatus | null;
  activeAgendas: number;
  trialBookingsUsed: number;
  /** `null` quando o tenant ainda não criou subconta Asaas. */
  kycStatus: KycStatus | null;
}

/**
 * Trial do produto = sem `PlatformSub` (ainda não escolheu plano) OU assinatura
 * ainda `TRIALING` (trial de cobrança do provedor). Mesma linha de corte de
 * `lib/billing/limits.ts` e `lib/billing/trial.ts` — um só conceito, três telas.
 */
export function isTenantInTrial(status: SubscriptionStatus | null | undefined): boolean {
  return status === null || status === undefined || status === 'TRIALING';
}

export interface PlatformMetrics {
  /** Soma das mensalidades de assinaturas `ACTIVE`, em centavos. */
  mrrCents: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  canceledSubscriptions: number;
  /** Canceladas ÷ (ativas + inadimplentes + canceladas). 0..1. */
  churnRate: number;
  trialTenants: number;
  convertedTenants: number;
  /** Convertidos ÷ (convertidos + em trial). 0..1. */
  conversionRate: number;
  totalTenants: number;
}

/**
 * Números do negócio a partir das linhas do diretório.
 *
 * DECISÕES DE DEFINIÇÃO:
 *
 *   - MRR conta SÓ `ACTIVE`. `PAST_DUE` é contrato em atraso, não receita do
 *     mês; somá-lo inflaria o número que o dono da plataforma usa para decidir.
 *   - Churn é sobre a base PAGA (ativas + inadimplentes + canceladas). Trial
 *     que não converteu é problema de conversão, não de churn — misturar os
 *     dois faria a taxa de churn subir quando um salão de teste fecha, que não
 *     é receita perdida.
 *   - Conversão é convertidos ÷ (convertidos + em trial), o complemento exato
 *     do funil de trial.
 *   - É um SNAPSHOT, não uma janela: não há histórico de transição de status no
 *     banco (o `PlatformSub` guarda só o estado atual). Churn por período exige
 *     o registro de eventos de assinatura — trabalho da F8 (Stripe real).
 *   - Base vazia devolve 0 (nunca `NaN`): a tela não pode exibir "NaN%".
 */
export function computePlatformMetrics(
  tenants: readonly PlatformTenantRow[],
): PlatformMetrics {
  let mrrCents = 0;
  let activeSubscriptions = 0;
  let pastDueSubscriptions = 0;
  let canceledSubscriptions = 0;
  let trialTenants = 0;
  let convertedTenants = 0;

  for (const tenant of tenants) {
    if (isTenantInTrial(tenant.subscriptionStatus)) {
      trialTenants += 1;
      continue;
    }

    convertedTenants += 1;
    if (tenant.subscriptionStatus === 'ACTIVE') {
      activeSubscriptions += 1;
      if (tenant.plan) mrrCents += BILLING_PLANS[tenant.plan].priceCents;
    } else if (tenant.subscriptionStatus === 'PAST_DUE') {
      pastDueSubscriptions += 1;
    } else if (tenant.subscriptionStatus === 'CANCELED') {
      canceledSubscriptions += 1;
    }
  }

  const payingBase = activeSubscriptions + pastDueSubscriptions + canceledSubscriptions;
  const funnel = convertedTenants + trialTenants;

  return {
    mrrCents,
    activeSubscriptions,
    pastDueSubscriptions,
    canceledSubscriptions,
    churnRate: payingBase > 0 ? canceledSubscriptions / payingBase : 0,
    trialTenants,
    convertedTenants,
    conversionRate: funnel > 0 ? convertedTenants / funnel : 0,
    totalTenants: tenants.length,
  };
}
