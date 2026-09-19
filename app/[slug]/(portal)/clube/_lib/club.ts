import { listCreditBalances } from '@/lib/membership/credits';
import { getPlan } from '@/lib/membership/plans';
import { listCustomerMemberships } from '@/lib/membership/subscription';
import type { TenantTransaction } from '@/lib/tenant/db';
import type {
  CustomerClubBenefit,
  CustomerClubData,
  CustomerClubMembership,
} from './types';

/**
 * Leitura do clube do cliente logado (tarefa F5.3).
 *
 * ISOLAMENTO EM DUAS CAMADAS, como manda o `contexto-comum.md` §4. Toda consulta
 * passa pelo client escopado (a RLS isola o TENANT) e, por cima, o filtro é
 * SEMPRE o `memberId` da sessão. Sem o segundo filtro, o cliente veria a
 * assinatura de outra pessoa do mesmo salão — o isolamento cliente × cliente que
 * o teste cobre. O `memberId` nunca vem de input: é derivado da sessão na página.
 *
 * AS REGRAS NÃO SÃO REIMPLEMENTADAS AQUI. Este módulo só LÊ:
 *   - a assinatura, de `listCustomerMemberships` (F5.1);
 *   - o saldo, de `listCreditBalances` (F5.2), que soma o ledger append-only;
 *   - a cota do plano, de `getPlan` (F5.0).
 * Recalcular saldo por contador na tela seria exatamente a regressão proibida.
 *
 * O contrato de contexto é estreito de propósito (`CustomerClubContext` em vez de
 * `TenantContext` inteiro): a função só precisa do id do tenant, do fuso e do
 * runner escopado, e assim é testável sem montar um `TenantRoutingInfo` completo.
 */

/** Assinaturas que ainda contam como "clube atual" do cliente. */
const CURRENT_STATUSES = new Set(['ACTIVE', 'PAST_DUE']);

export interface CustomerClubContext {
  tenant: { id: string; timezone: string };
  forTenant<T>(fn: (tx: TenantTransaction) => Promise<T>): Promise<T>;
}

export async function loadCustomerClub(
  ctx: CustomerClubContext,
  memberId: string,
): Promise<CustomerClubData> {
  const timezone = ctx.tenant.timezone;

  const memberships = await ctx.forTenant(async (tx) => {
    const all = await listCustomerMemberships(tx, ctx.tenant.id, memberId);
    const current = all.filter((membership) => CURRENT_STATUSES.has(membership.status));

    const views: CustomerClubMembership[] = [];
    for (const membership of current) {
      const plan = await getPlan(tx, ctx.tenant.id, membership.planId);
      const balances = await listCreditBalances(tx, ctx.tenant.id, membership.id);

      views.push({
        id: membership.id,
        planName: membership.planName,
        cycle: plan?.cycle ?? 'MONTHLY',
        status: membership.status,
        contractedPriceCents: membership.contractedPriceCents,
        currentPeriodEnd: membership.currentPeriodEnd,
        nextChargeLabel: chargeDateLabel(membership.currentPeriodEnd, timezone),
        cardBrand: membership.cardBrand,
        cardLastFour: membership.cardLastFour,
        benefits: mergeBenefits(plan?.benefits ?? [], balances),
      });
    }
    return views;
  });

  return { timezone, memberships };
}

/**
 * Junta a cota do plano com o saldo do ledger, por serviço. Um serviço com
 * lançamento mas sem benefício no plano ainda aparece (cota 0), para o saldo
 * nunca sumir da tela.
 */
function mergeBenefits(
  planBenefits: readonly {
    serviceId: string;
    serviceName: string;
    quantityPerCycle: number;
  }[],
  balances: readonly { serviceId: string; serviceName: string; balance: number }[],
): CustomerClubBenefit[] {
  const byService = new Map<string, CustomerClubBenefit>();

  for (const balance of balances) {
    byService.set(balance.serviceId, {
      serviceId: balance.serviceId,
      serviceName: balance.serviceName,
      quantityPerCycle: 0,
      balance: balance.balance,
    });
  }

  for (const benefit of planBenefits) {
    const existing = byService.get(benefit.serviceId);
    byService.set(benefit.serviceId, {
      serviceId: benefit.serviceId,
      serviceName: benefit.serviceName,
      quantityPerCycle: benefit.quantityPerCycle,
      balance: existing?.balance ?? 0,
    });
  }

  return [...byService.values()].sort((a, b) =>
    a.serviceName.localeCompare(b.serviceName, 'pt-BR'),
  );
}

/** Data de calendário do tenant, "DD/MM/AAAA". */
function chargeDateLabel(instant: string | null, timezone: string): string | null {
  if (!instant) return null;
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}
