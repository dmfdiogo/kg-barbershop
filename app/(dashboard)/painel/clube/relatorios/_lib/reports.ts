import type { TenantTransaction } from '@/lib/tenant/db';
import { CREDIT_REASON } from '@/lib/membership/credits';
import type { MembershipCycle } from '@/lib/membership/plans';
import type { MembershipStatus } from '@/lib/membership/subscription';

/**
 * Relatórios do clube para o dono (tarefa F5.3).
 *
 * TRÊS NÚMEROS, TRÊS CUIDADOS.
 *
 *   1. MRR NÃO É A SOMA DE `plan.priceCents`. Cada `Membership` carrega o preço
 *      que AQUELE cliente aceitou (`contractedPriceCents`), congelado no ato da
 *      assinatura. O dono pode reajustar o plano sem tocar em quem já assinou —
 *      o seed monta o caso de propósito (plano a R$ 79,00, assinante a R$ 69,00).
 *      Somar o preço corrente inflaria a receita recorrente.
 *
 *   2. CICLOS DIFERENTES NÃO SE SOMAM CRUS. `MembershipPlan.cycle` vai de
 *      semanal a anual, então R$ 120,00/ano e R$ 30,00/mês não são o mesmo
 *      número. A normalização acontece em DUAS etapas, com arredondamento UMA
 *      vez só: cada assinatura vira o equivalente ANUAL (`preço × períodos por
 *      ano`, inteiro em centavos) e a soma anual é dividida por 12 no fim.
 *      Somar mensalidades arredondadas uma a uma acumularia o erro de arredondamento
 *      de cada linha; arredondar no total o elimina.
 *
 *   3. "INADIMPLENTE" É `MembershipStatus.PAST_DUE`, e nada mais. Não há
 *      heurística de data: o status é a fonte de verdade do ciclo de vida (F5.1).
 *
 * O MRR conta apenas assinaturas ATIVAS. Uma assinatura `PAST_DUE` é receita em
 * risco, não receita recorrente — por isso ela aparece como inadimplente em
 * coluna separada, jamais somada ao MRR. Essa decisão é documentada aqui de
 * propósito: é o tipo de critério que muda o número que o dono lê.
 *
 * ISOLAMENTO (contexto-comum.md §4). Toda função recebe uma transação JÁ escopada
 * e o `tenantId` explícito; a RLS continua valendo por cima. Consumo e assinantes
 * de outro salão não aparecem.
 *
 * O CONSUMO VEM DO LEDGER, não de contador paralelo. `creditLedger` é
 * append-only e o consumido por serviço é a soma dos lançamentos
 * `booking_consumed` daquele serviço (F5.2). Um contador separado seria a
 * regressão que a fase proíbe.
 */

// ---------------------------------------------------------------------------
// Normalização de ciclo → mês
// ---------------------------------------------------------------------------

/**
 * Quantas cobranças o ciclo faz por ano. `preço × períodosPorAno` dá o valor
 * anual em centavos, inteiro, sem ponto flutuante.
 */
export const PERIODS_PER_YEAR: Readonly<Record<MembershipCycle, number>> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUALLY: 2,
  YEARLY: 1,
};

/** Equivalente anual, em centavos, do preço contratado de um ciclo. */
export function annualizedContractedCents(
  contractedPriceCents: number,
  cycle: MembershipCycle,
): number {
  return contractedPriceCents * PERIODS_PER_YEAR[cycle];
}

/** Converte um total ANUAL (em centavos) para o mensal, arredondando UMA vez. */
export function monthlyRecurringCents(totalAnnualCents: number): number {
  return Math.round(totalAnnualCents / 12);
}

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export interface RecurringMembershipRow {
  status: MembershipStatus;
  contractedPriceCents: number;
  cycle: MembershipCycle;
}

export interface ClubReportSummary {
  /** Assinaturas com status ACTIVE. */
  activeSubscribers: number;
  /** Assinaturas com status PAST_DUE — os inadimplentes. */
  pastDueSubscribers: number;
  /** Receita recorrente mensal, do preço CONTRATADO das assinaturas ativas. */
  mrrCents: number;
}

export interface ClubSubscriberView {
  membershipId: string;
  customerName: string;
  planName: string;
  cycle: MembershipCycle;
  status: MembershipStatus;
  contractedPriceCents: number;
  currentPeriodEnd: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
}

export interface ClubConsumptionView {
  serviceId: string;
  serviceName: string;
  /** Créditos consumidos em agendamentos (`booking_consumed`), em módulo. */
  consumedCredits: number;
  /** Saldo líquido ainda em aberto no ledger para o serviço. */
  outstandingCredits: number;
}

export interface ClubReport extends ClubReportSummary {
  subscribers: ClubSubscriberView[];
  consumption: ClubConsumptionView[];
}

// ---------------------------------------------------------------------------
// Resumo puro (testável sem Postgres)
// ---------------------------------------------------------------------------

/**
 * Resume as assinaturas: contagens e MRR normalizado para o mês. PURO, de
 * propósito — a regra de normalização é o coração dos relatórios e não deveria
 * exigir banco para ser provada.
 */
export function summarizeRecurring(
  rows: readonly RecurringMembershipRow[],
): ClubReportSummary {
  let activeSubscribers = 0;
  let pastDueSubscribers = 0;
  let totalAnnualCents = 0;

  for (const row of rows) {
    if (row.status === 'ACTIVE') {
      activeSubscribers += 1;
      totalAnnualCents += annualizedContractedCents(row.contractedPriceCents, row.cycle);
    } else if (row.status === 'PAST_DUE') {
      pastDueSubscribers += 1;
    }
  }

  return {
    activeSubscribers,
    pastDueSubscribers,
    mrrCents: monthlyRecurringCents(totalAnnualCents),
  };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/**
 * Carrega o relatório do clube do tenant. Só ACTIVE e PAST_DUE entram: o dono
 * olha a carteira vigente e a inadimplência, não o histórico de cancelados.
 */
export async function loadClubReport(
  tx: TenantTransaction,
  tenantId: string,
): Promise<ClubReport> {
  const memberships = await tx.membership.findMany({
    where: { tenantId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      status: true,
      contractedPriceCents: true,
      currentPeriodEnd: true,
      cardBrand: true,
      cardLastFour: true,
      plan: { select: { name: true, cycle: true } },
      customer: { select: { user: { select: { name: true } } } },
    },
  });

  const recurringRows: RecurringMembershipRow[] = memberships.map((membership) => ({
    status: membership.status as MembershipStatus,
    contractedPriceCents: membership.contractedPriceCents,
    cycle: membership.plan.cycle as MembershipCycle,
  }));

  const subscribers: ClubSubscriberView[] = memberships.map((membership) => ({
    membershipId: membership.id,
    customerName: membership.customer.user.name,
    planName: membership.plan.name,
    cycle: membership.plan.cycle as MembershipCycle,
    status: membership.status as MembershipStatus,
    contractedPriceCents: membership.contractedPriceCents,
    currentPeriodEnd: membership.currentPeriodEnd?.toISOString() ?? null,
    cardBrand: membership.cardBrand,
    cardLastFour: membership.cardLastFour,
  }));

  const consumption = await loadConsumption(tx, tenantId);

  return { ...summarizeRecurring(recurringRows), subscribers, consumption };
}

/**
 * Consumo por serviço, derivado do ledger. `consumed` soma o módulo dos
 * lançamentos `booking_consumed`; `outstanding` é o saldo líquido ainda em
 * aberto (concedido − consumido − expirado + devolvido).
 */
async function loadConsumption(
  tx: TenantTransaction,
  tenantId: string,
): Promise<ClubConsumptionView[]> {
  const consumedRows = await tx.creditLedger.groupBy({
    by: ['serviceId'],
    where: { tenantId, reason: CREDIT_REASON.bookingConsumed },
    _sum: { delta: true },
  });

  const netRows = await tx.creditLedger.groupBy({
    by: ['serviceId'],
    where: { tenantId },
    _sum: { delta: true },
  });

  const serviceIds = new Set<string>();
  for (const row of consumedRows) serviceIds.add(row.serviceId);
  for (const row of netRows) serviceIds.add(row.serviceId);
  if (serviceIds.size === 0) return [];

  const services = await tx.service.findMany({
    where: { tenantId, id: { in: [...serviceIds] } },
    select: { id: true, name: true },
  });
  const names = new Map(services.map((service) => [service.id, service.name]));

  const consumedByService = new Map(
    consumedRows.map((row) => [row.serviceId, Math.abs(row._sum.delta ?? 0)]),
  );
  const netByService = new Map(netRows.map((row) => [row.serviceId, row._sum.delta ?? 0]));

  return [...serviceIds]
    .map((serviceId) => ({
      serviceId,
      serviceName: names.get(serviceId) ?? 'Serviço',
      consumedCredits: consumedByService.get(serviceId) ?? 0,
      outstandingCredits: netByService.get(serviceId) ?? 0,
    }))
    .sort(
      (a, b) =>
        b.consumedCredits - a.consumedCredits ||
        a.serviceName.localeCompare(b.serviceName, 'pt-BR'),
    );
}
