import type { TenantTransaction } from '@/lib/tenant/db';

/**
 * Créditos do clube de assinatura do tenant (tarefa F5.2).
 *
 * O LEDGER É APPEND-ONLY. `CreditLedger` é uma pilha de lançamentos e o saldo é
 * a SOMA de `delta` para (membership, serviço) — nunca um contador mutável. A
 * armadilha que isso evita é concreta: `UPDATE ... SET remaining = remaining - 1`
 * fora da transação do agendamento gera crédito fantasma, e no piloto alguém
 * pergunta "por que meu crédito sumiu?". Com lançamentos, a resposta é uma
 * consulta: concedido no ciclo, consumido no agendamento X, devolvido no
 * cancelamento, expirado na renovação. Nada é editado; o passado é imutável.
 *
 * POR QUE A SOMA NÃO SE PROTEGE SOZINHA (e o que protege aqui). Dois
 * agendamentos simultâneos com um único crédito fazem o seguinte, sem lock:
 * as duas transações leem `SUM(delta) = 1`, as duas inserem `-1` e o banco
 * aceita as duas — nenhuma linha foi ATUALIZADA, então não há conflito para o
 * Postgres detectar. É write-skew clássico, e o resultado é saldo negativo,
 * ou seja, serviço de graça. A defesa SEM tocar o schema (congelado) é uma
 * trava de linha na `Membership` (`SELECT ... FOR UPDATE`): o segundo
 * consumidor espera o primeiro commitar e relê o saldo já zero. A escolha é
 * deliberada — o nível de isolamento SERIALIZABLE resolveria, mas custa
 * abortos/retry na transação inteira do agendamento por causa de uma linha de
 * crédito; a trava de linha serializa só quem disputa o MESMO clube, que é
 * exatamente o escopo do recurso.
 *
 * CONSUMO NA MESMA TRANSAÇÃO DO AGENDAMENTO. Quem chama
 * `applyCreditForBooking` é o participante de transação da confirmação
 * (`lib/booking/participants/credits.ts`), com a transação já escopada no
 * tenant. O rollback leva o lançamento junto e o retry do client escopado
 * (P2034) reaplica sem duplicar. Nunca há crédito debitado sem agendamento
 * (o `bookingId` da linha é a FK) nem dois débitos para o mesmo agendamento
 * (a checagem por `bookingId` sob a trava).
 *
 * CANCELAMENTO DEVOLVE COMO LANÇAMENTO NOVO. `refundCreditForBooking` insere um
 * `delta` positivo (`booking_refunded`) referenciando o mesmo agendamento — não
 * edita o débito original. Idempotente: um segundo cancelamento (ou reentrega
 * do handler) encontra o estorno e não credita de novo.
 *
 * POLÍTICA DE CICLO — DECISÃO: crédito não usado EXPIRA no fim do ciclo, não
 * acumula. `renewCycleCredits` primeiro zera o saldo remanescente com um
 * lançamento negativo (`cycle_expired`) e só então concede o ciclo novo. É a
 * recomendação do produto: "2 cortes/mês" é 2 por mês; acumular transformaria
 * um mês de ausência em quatro cortes no mês seguinte e quebraria a previsão de
 * caixa do salão. O aviso ao cliente é responsabilidade das visões (F5.3);
 * aqui fica o mecanismo. Renovação e falha de cobrança são da F5.1, que chama
 * estes primitivos dentro do próprio processamento de webhook idempotente.
 *
 * ISOLAMENTO (contexto-comum.md §4). Toda função recebe uma transação JÁ
 * escopada e o `tenantId` explícito; a RLS continua valendo por cima. Um saldo
 * de outro salão nunca é lido nem escrito.
 *
 * CLIENTE AINDA PAGA SINAL? Pendência de produto (`Tenant.membershipRequiresDeposit`,
 * default `false`). Este módulo não decide a política: lê a flag do tenant em
 * `decideCreditBooking` e isola a decisão. Com `false`, assinante com crédito
 * não paga sinal; com `true`, paga — a cobrança do sinal é do fluxo da F4.
 */

// ---------------------------------------------------------------------------
// Razões do ledger
// ---------------------------------------------------------------------------

/**
 * Motivos de lançamento. Os valores são `snake_case` e batem com o seed
 * (`cycle_grant`, `booking_consumed`); a coluna é `String` de propósito, para
 * que um motivo novo não exija migration.
 */
export const CREDIT_REASON = {
  /** Concessão do ciclo (renovação). Positivo. */
  cycleGrant: 'cycle_grant',
  /** Consumo por um agendamento confirmado. Negativo. */
  bookingConsumed: 'booking_consumed',
  /** Devolução por cancelamento. Positivo, novo lançamento. */
  bookingRefunded: 'booking_refunded',
  /** Crédito não usado que expira na virada do ciclo. Negativo. */
  cycleExpired: 'cycle_expired',
} as const;

export type CreditReason = (typeof CREDIT_REASON)[keyof typeof CREDIT_REASON];

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

export class InsufficientCreditError extends Error {
  readonly code = 'INSUFFICIENT_CREDIT' as const;
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = 'InsufficientCreditError';
  }
}

// ---------------------------------------------------------------------------
// Leitura de saldo
// ---------------------------------------------------------------------------

/** Saldo de um serviço: a SOMA dos lançamentos, nunca um contador. */
export async function getServiceCreditBalance(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
  serviceId: string,
): Promise<number> {
  const aggregate = await tx.creditLedger.aggregate({
    where: { tenantId, membershipId, serviceId },
    _sum: { delta: true },
  });
  return aggregate._sum.delta ?? 0;
}

export interface CreditBalanceView {
  serviceId: string;
  serviceName: string;
  balance: number;
}

/** Saldos por serviço de uma assinatura, para as visões do clube (F5.3). */
export async function listCreditBalances(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
): Promise<CreditBalanceView[]> {
  const grouped = await tx.creditLedger.groupBy({
    by: ['serviceId'],
    where: { tenantId, membershipId },
    _sum: { delta: true },
  });

  const serviceIds = grouped.map((row) => row.serviceId);
  if (serviceIds.length === 0) return [];

  const services = await tx.service.findMany({
    where: { tenantId, id: { in: serviceIds } },
    select: { id: true, name: true },
  });
  const names = new Map(services.map((service) => [service.id, service.name]));

  return grouped
    .map((row) => ({
      serviceId: row.serviceId,
      serviceName: names.get(row.serviceId) ?? 'Serviço',
      balance: row._sum.delta ?? 0,
    }))
    .filter((row) => row.balance !== 0)
    .sort((a, b) => a.serviceName.localeCompare(b.serviceName, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Cobertura de crédito
// ---------------------------------------------------------------------------

export interface ActiveMembership {
  id: string;
  planId: string;
}

/** Assinatura ativa do cliente. Um cliente só tem uma assinatura por salão. */
export async function findActiveMembership(
  tx: TenantTransaction,
  tenantId: string,
  customerId: string,
): Promise<ActiveMembership | null> {
  const membership = await tx.membership.findFirst({
    where: { tenantId, customerId, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, planId: true },
  });
  return membership;
}

export interface CreditCoverage {
  membershipId: string;
  planId: string;
  serviceId: string;
  quantityPerCycle: number;
  balance: number;
}

/**
 * Diz se o serviço é coberto pelo clube e qual o saldo. `null` quando não há
 * assinatura ativa ou o plano não tem benefício para o serviço. Esta é a
 * leitura que o fluxo de agendamento usa para decidir pular o checkout da F4 —
 * a decisão de consumo autoritativa, porém, é a da trava em
 * `applyCreditForBooking`.
 */
export async function findCreditCoverage(
  tx: TenantTransaction,
  tenantId: string,
  customerId: string,
  serviceId: string,
): Promise<CreditCoverage | null> {
  const membership = await findActiveMembership(tx, tenantId, customerId);
  if (!membership) return null;

  const benefit = await tx.membershipBenefit.findFirst({
    where: { tenantId, planId: membership.planId, serviceId },
    select: { quantityPerCycle: true },
  });
  if (!benefit) return null;

  const balance = await getServiceCreditBalance(tx, tenantId, membership.id, serviceId);
  return {
    membershipId: membership.id,
    planId: membership.planId,
    serviceId,
    quantityPerCycle: benefit.quantityPerCycle,
    balance,
  };
}

// ---------------------------------------------------------------------------
// Política de sinal (isolada, aguardando decisão de produto)
// ---------------------------------------------------------------------------

export interface CreditBookingDecision {
  membershipId: string | null;
  /** `true` quando há clube ativo, benefício para o serviço e saldo ≥ 1. */
  useCredit: boolean;
  /**
   * Sinal como garantia contra no-show. Só faz sentido quando o crédito cobre
   * o serviço; sem crédito, o sinal segue a modalidade normal do checkout.
   */
  requiresDeposit: boolean;
  balance: number;
}

export interface DecideCreditBookingInput {
  tenantId: string;
  customerId: string;
  serviceId: string;
  /** `Tenant.membershipRequiresDeposit` — a flag de política do tenant. */
  membershipRequiresDeposit: boolean;
}

/**
 * Regra PURA da decisão de cobertura, separada da leitura de banco para poder
 * ser testada sem Postgres. A pendência de produto vive aqui: com
 * `membershipRequiresDeposit = true`, o assinante com crédito ainda paga sinal
 * como garantia contra no-show; com `false` (default), não paga.
 */
export function resolveCreditBookingDecision(
  coverage: CreditCoverage | null,
  membershipRequiresDeposit: boolean,
): CreditBookingDecision {
  if (!coverage) {
    return { membershipId: null, useCredit: false, requiresDeposit: false, balance: 0 };
  }

  const useCredit = coverage.balance >= 1;
  return {
    membershipId: coverage.membershipId,
    useCredit,
    requiresDeposit: useCredit ? membershipRequiresDeposit : false,
    balance: coverage.balance,
  };
}

/**
 * Decisão de uso do crédito no fluxo de agendamento, com a pendência de produto
 * isolada na flag `Tenant.membershipRequiresDeposit`. Com `false` (default), o
 * assinante com crédito confirma sem sinal; com `true`, o fluxo ainda cobra o
 * sinal como garantia. Quem executa a cobrança do sinal é o checkout da F4.
 */
export async function decideCreditBooking(
  tx: TenantTransaction,
  input: DecideCreditBookingInput,
): Promise<CreditBookingDecision> {
  const coverage = await findCreditCoverage(
    tx,
    input.tenantId,
    input.customerId,
    input.serviceId,
  );
  return resolveCreditBookingDecision(coverage, input.membershipRequiresDeposit);
}

// ---------------------------------------------------------------------------
// Consumo
// ---------------------------------------------------------------------------

export interface ConsumeCreditInput {
  tenantId: string;
  bookingId: string;
  customerId: string;
  serviceId: string;
}

export type ConsumeCreditOutcome =
  | { kind: 'consumed'; membershipId: string; balanceAfter: number }
  | { kind: 'already-consumed'; membershipId: string }
  | { kind: 'no-credit' }
  | { kind: 'insufficient' };

/**
 * Trava a assinatura para serializar consumidores do MESMO clube. É o
 * mecanismo que fecha o write-skew descrito no topo do arquivo: sem ela, duas
 * transações leem o mesmo saldo e as duas debitam.
 */
async function lockMembership(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM membership
    WHERE tenant_id = ${tenantId} AND id = ${membershipId}
    FOR UPDATE
  `;
}

/** Status de `Payment` que significam "o cliente escolheu/efetuou a cobrança". */
const PAYMENT_BLOCKS_CREDIT = ['PENDING', 'PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;

/**
 * Núcleo do consumo: consome se houver cobertura e saldo, e NÃO lança quando
 * não há. É a forma que o participante usa — um agendamento sem crédito segue
 * normalmente (pago no checkout ou no balcão), e um agendamento de assinante
 * com saldo zero não pode falhar só por causa disso.
 *
 * A versão estrita (`consumeCreditForBooking`) é a que lança
 * `InsufficientCreditError`, e é o contrato que o teste de concorrência prova.
 *
 * Regras que a função garante, todas sob a trava da assinatura:
 *  - nunca dois créditos para o mesmo agendamento (checa `bookingId`);
 *  - nunca saldo negativo (relê a soma já sob a trava);
 *  - nunca consome se já existe cobrança para o agendamento.
 */
export async function applyCreditForBooking(
  tx: TenantTransaction,
  input: ConsumeCreditInput,
): Promise<ConsumeCreditOutcome> {
  const existing = await tx.creditLedger.findFirst({
    where: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      reason: CREDIT_REASON.bookingConsumed,
    },
    select: { membershipId: true },
  });
  if (existing) return { kind: 'already-consumed', membershipId: existing.membershipId };

  const payment = await tx.payment.findFirst({
    where: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      status: { in: [...PAYMENT_BLOCKS_CREDIT] },
    },
    select: { id: true },
  });
  if (payment) return { kind: 'no-credit' };

  const coverage = await findCreditCoverage(
    tx,
    input.tenantId,
    input.customerId,
    input.serviceId,
  );
  if (!coverage) return { kind: 'no-credit' };

  await lockMembership(tx, input.tenantId, coverage.membershipId);

  // Relê o débito DEPOIS da trava: duas confirmações do MESMO agendamento
  // (clique duplo, retry) serializam aqui e a segunda encontra o lançamento da
  // primeira. Sem esta releitura, as duas passariam pela checagem anterior,
  // feita antes de qualquer lock, e debitariam duas vezes.
  const raced = await tx.creditLedger.findFirst({
    where: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      reason: CREDIT_REASON.bookingConsumed,
    },
    select: { membershipId: true },
  });
  if (raced) return { kind: 'already-consumed', membershipId: raced.membershipId };

  const balance = await getServiceCreditBalance(
    tx,
    input.tenantId,
    coverage.membershipId,
    input.serviceId,
  );
  if (balance < 1) return { kind: 'insufficient' };

  await tx.creditLedger.create({
    data: {
      tenantId: input.tenantId,
      membershipId: coverage.membershipId,
      serviceId: input.serviceId,
      delta: -1,
      reason: CREDIT_REASON.bookingConsumed,
      bookingId: input.bookingId,
    },
  });

  return {
    kind: 'consumed',
    membershipId: coverage.membershipId,
    balanceAfter: balance - 1,
  };
}

/**
 * Consumo estrito: lança quando não há crédito aplicável ou o saldo acabou.
 * Use quando o chamador JÁ decidiu usar o crédito (ex.: teste de concorrência);
 * o participante da confirmação usa `applyCreditForBooking`.
 */
export async function consumeCreditForBooking(
  tx: TenantTransaction,
  input: ConsumeCreditInput,
): Promise<ConsumeCreditOutcome> {
  const outcome = await applyCreditForBooking(tx, input);
  if (outcome.kind === 'no-credit') {
    throw new InsufficientCreditError(
      'O cliente não tem clube ativo com benefício para este serviço.',
    );
  }
  if (outcome.kind === 'insufficient') {
    throw new InsufficientCreditError('Saldo de créditos insuficiente para este serviço.');
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Devolução no cancelamento
// ---------------------------------------------------------------------------

export type RefundCreditOutcome =
  | { kind: 'refunded'; membershipId: string; amount: number }
  | { kind: 'already-refunded'; membershipId: string }
  | { kind: 'nothing-to-refund' };

/**
 * Devolve o crédito consumido por um agendamento cancelado, como LANÇAMENTO
 * NOVO. Se o agendamento não consumiu crédito (foi pago, ou nunca teve clube),
 * não faz nada. Idempotente sob a trava: uma segunda chamada encontra o
 * estorno e não credita de novo.
 */
export async function refundCreditForBooking(
  tx: TenantTransaction,
  tenantId: string,
  bookingId: string,
): Promise<RefundCreditOutcome> {
  const debit = await tx.creditLedger.findFirst({
    where: { tenantId, bookingId, reason: CREDIT_REASON.bookingConsumed },
    select: { membershipId: true, serviceId: true, delta: true },
  });
  if (!debit) return { kind: 'nothing-to-refund' };

  await lockMembership(tx, tenantId, debit.membershipId);

  const already = await tx.creditLedger.findFirst({
    where: { tenantId, bookingId, reason: CREDIT_REASON.bookingRefunded },
    select: { id: true },
  });
  if (already) return { kind: 'already-refunded', membershipId: debit.membershipId };

  const amount = Math.abs(debit.delta);
  await tx.creditLedger.create({
    data: {
      tenantId,
      membershipId: debit.membershipId,
      serviceId: debit.serviceId,
      delta: amount,
      reason: CREDIT_REASON.bookingRefunded,
      bookingId,
    },
  });

  return { kind: 'refunded', membershipId: debit.membershipId, amount };
}

// ---------------------------------------------------------------------------
// Ciclo: concessão, expiração e renovação
// ---------------------------------------------------------------------------

export interface GrantedCredit {
  serviceId: string;
  quantityPerCycle: number;
}

/**
 * Concede os créditos do ciclo a partir dos benefícios do plano. Cada linha é
 * um `cycle_grant` positivo. Não é idempotente por si só: deve rodar dentro da
 * transação de renovação (F5.1), que é idempotente pelo `WebhookEvent`; um
 * retry do client escopado desfaz e reaplica as linhas sem duplicar.
 */
export async function grantCycleCredits(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
  planId: string,
): Promise<GrantedCredit[]> {
  const benefits = await tx.membershipBenefit.findMany({
    where: { tenantId, planId },
    orderBy: { createdAt: 'asc' },
    select: { serviceId: true, quantityPerCycle: true },
  });
  if (benefits.length === 0) return [];

  await lockMembership(tx, tenantId, membershipId);
  await tx.creditLedger.createMany({
    data: benefits.map((benefit) => ({
      tenantId,
      membershipId,
      serviceId: benefit.serviceId,
      delta: benefit.quantityPerCycle,
      reason: CREDIT_REASON.cycleGrant,
    })),
  });

  return benefits.map((benefit) => ({
    serviceId: benefit.serviceId,
    quantityPerCycle: benefit.quantityPerCycle,
  }));
}

/**
 * Zera o saldo remanescente do ciclo (política: expira, não acumula). Concede o
 * espelho negativo de cada saldo positivo como `cycle_expired`. Devolve o total
 * expirado, em créditos. Sob a trava, chamadas concorrentes não expiram duas
 * vezes.
 */
export async function expireUnusedCycleCredits(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
): Promise<number> {
  await lockMembership(tx, tenantId, membershipId);

  const grouped = await tx.creditLedger.groupBy({
    by: ['serviceId'],
    where: { tenantId, membershipId },
    _sum: { delta: true },
  });

  let expired = 0;
  for (const row of grouped) {
    const balance = row._sum.delta ?? 0;
    if (balance <= 0) continue;
    await tx.creditLedger.create({
      data: {
        tenantId,
        membershipId,
        serviceId: row.serviceId,
        delta: -balance,
        reason: CREDIT_REASON.cycleExpired,
      },
    });
    expired += balance;
  }
  return expired;
}

export interface RenewCycleResult {
  expired: number;
  granted: GrantedCredit[];
}

/**
 * Renovação do ciclo: expira o que sobrou e credita o ciclo novo. É a decisão
 * de produto documentada no topo do arquivo, executável em uma chamada só pela
 * F5.1.
 */
export async function renewCycleCredits(
  tx: TenantTransaction,
  tenantId: string,
  membershipId: string,
  planId: string,
): Promise<RenewCycleResult> {
  const expired = await expireUnusedCycleCredits(tx, tenantId, membershipId);
  const granted = await grantCycleCredits(tx, tenantId, membershipId, planId);
  return { expired, granted };
}
