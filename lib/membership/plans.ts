import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import { parseIntInRange, parseMoneyToCents } from '@/lib/catalog/money';

/**
 * Planos e benefícios do clube de assinatura do tenant (tarefa F5.0).
 *
 * O clube pertence ao ESTABELECIMENTO: preço, ciclo, benefícios e recebimento
 * são do salão. Nada aqui reaproveita a assinatura antiga de plataforma
 * (`Subscription`/`SubscriptionBenefit`) — o modelo é `MembershipPlan` +
 * `MembershipBenefit`.
 *
 * ISOLAMENTO (contexto-comum.md §4). As funções de dados recebem uma transação
 * JÁ escopada pelo tenant (`context.forTenant`) e o `tenantId`. Toda query
 * carrega `tenantId` explícito; a RLS continua valendo por cima. Os benefícios
 * são vinculados só a serviços daquele tenant — um id de outro salão nunca vira
 * vínculo.
 *
 * PREÇO CONTRATADO × PREÇO CORRENTE. Reajustar um plano é só atualizar
 * `MembershipPlan.priceCents`; este módulo NUNCA escreve em
 * `Membership.contractedPriceCents`. Quem cobra (F5.1) lê o preço CONGELADO
 * `membership.contractedPriceCents`, nunca `plan.priceCents`: o assinante
 * continua pagando o que aceitou até uma decisão explícita de migração. Ler o
 * preço corrente do plano na renovação seria reajuste silencioso.
 *
 * Este módulo é seguro para o bundle do cliente: não importa valor de runtime
 * do Prisma Client (só `import type`, apagado na compilação) e as listas de
 * ciclos/rótulos são literais. Os componentes de cliente importam daqui tipos,
 * ciclos e a mensagem de recusa de exclusão sem arrastar o client para o
 * navegador.
 */

// ---------------------------------------------------------------------------
// Ciclos
// ---------------------------------------------------------------------------

/** Espelha o enum `MembershipCycle` do schema, sem importar o valor do Prisma. */
export const MEMBERSHIP_CYCLES = [
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUALLY',
  'YEARLY',
] as const;

export type MembershipCycle = (typeof MEMBERSHIP_CYCLES)[number];

export const MEMBERSHIP_CYCLE_LABELS: Record<MembershipCycle, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
};

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

export interface PlanServiceOption {
  id: string;
  name: string;
  active: boolean;
}

export interface MembershipBenefitView {
  serviceId: string;
  serviceName: string;
  quantityPerCycle: number;
}

export interface MembershipPlanView {
  id: string;
  name: string;
  priceCents: number;
  cycle: MembershipCycle;
  active: boolean;
  benefits: MembershipBenefitView[];
}

/**
 * Entrada crua do formulário. O preço e a quantidade chegam como TEXTO de
 * propósito: a conversão para inteiro acontece uma única vez, no servidor
 * (`lib/catalog/money.ts`), nunca por `parseFloat`.
 */
export interface MembershipPlanFormInput {
  name?: unknown;
  price?: unknown;
  cycle?: unknown;
  active?: unknown;
  benefits?: unknown;
}

export type MembershipPlanField = 'name' | 'price' | 'cycle' | 'benefits';
export type MembershipPlanFieldErrors = Partial<Record<MembershipPlanField, string>>;

export interface ValidatedMembershipBenefit {
  serviceId: string;
  quantityPerCycle: number;
}

export interface ValidatedMembershipPlan {
  name: string;
  priceCents: number;
  cycle: MembershipCycle;
  active: boolean;
  benefits: ValidatedMembershipBenefit[];
}

export type MembershipPlanValidationResult =
  | { ok: true; value: ValidatedMembershipPlan }
  | { ok: false; fieldErrors: MembershipPlanFieldErrors };

export type MembershipPlanActionErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'HAS_MEMBERSHIPS'
  | 'ERROR';

export type MembershipPlanActionResult =
  | { ok: true; plan?: MembershipPlanView; deactivated?: boolean }
  | {
      ok: false;
      code: MembershipPlanActionErrorCode;
      message: string;
      fieldErrors?: MembershipPlanFieldErrors;
      /** Quantos assinantes bloqueiam a exclusão (quando houver). */
      memberships?: number;
    };

export type MembershipPlanDeletionAssessment =
  | { canDelete: true; memberships: 0 }
  | { canDelete: false; code: 'HAS_MEMBERSHIPS'; memberships: number };

export type MembershipPlanDeletionResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'HAS_MEMBERSHIPS'; memberships: number };

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

export const PLAN_NAME_MIN = 2;
export const PLAN_NAME_MAX = 80;
export const BENEFIT_QUANTITY_MIN = 1;
export const BENEFIT_QUANTITY_MAX = 99;

function isCycle(value: unknown): value is MembershipCycle {
  return typeof value === 'string' && (MEMBERSHIP_CYCLES as readonly string[]).includes(value);
}

interface RawBenefit {
  serviceId: string;
  quantityPerCycle: unknown;
}

function readRawBenefits(value: unknown): RawBenefit[] {
  if (!Array.isArray(value)) return [];
  const raw: RawBenefit[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as { serviceId?: unknown; quantityPerCycle?: unknown };
    const serviceId = typeof candidate.serviceId === 'string' ? candidate.serviceId.trim() : '';
    if (serviceId.length === 0) continue;
    raw.push({ serviceId, quantityPerCycle: candidate.quantityPerCycle });
  }
  return raw;
}

/**
 * Valida o formulário de plano. `allowedServiceIds` são os serviços DE VÁRIOS
 * TENANTS NÃO — apenas os do tenant que está salvando (carregados pela action).
 * Um id de outro salão vira erro de campo, nunca vínculo.
 */
export function validateMembershipPlanForm(
  input: MembershipPlanFormInput,
  allowedServiceIds: ReadonlySet<string>,
): MembershipPlanValidationResult {
  const fieldErrors: MembershipPlanFieldErrors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < PLAN_NAME_MIN || name.length > PLAN_NAME_MAX) {
    fieldErrors.name = `Informe um nome de ${PLAN_NAME_MIN} a ${PLAN_NAME_MAX} caracteres.`;
  }

  const priceCents = parseMoneyToCents(input.price);
  if (priceCents === null || priceCents <= 0) {
    fieldErrors.price = 'Informe um preço válido, ex.: 79,00.';
  }

  if (!isCycle(input.cycle)) {
    fieldErrors.cycle = 'Escolha o ciclo de cobrança.';
  }

  const seen = new Set<string>();
  const benefits: ValidatedMembershipBenefit[] = [];
  for (const raw of readRawBenefits(input.benefits)) {
    if (seen.has(raw.serviceId)) {
      fieldErrors.benefits = 'Cada serviço pode aparecer uma vez por plano.';
      continue;
    }
    seen.add(raw.serviceId);

    if (!allowedServiceIds.has(raw.serviceId)) {
      fieldErrors.benefits = 'Os benefícios só podem usar serviços deste estabelecimento.';
      continue;
    }

    const quantityPerCycle = parseIntInRange(
      raw.quantityPerCycle,
      BENEFIT_QUANTITY_MIN,
      BENEFIT_QUANTITY_MAX,
    );
    if (quantityPerCycle === null) {
      fieldErrors.benefits = `Informe uma quantidade entre ${BENEFIT_QUANTITY_MIN} e ${BENEFIT_QUANTITY_MAX} por ciclo.`;
      continue;
    }

    benefits.push({ serviceId: raw.serviceId, quantityPerCycle });
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const value: ValidatedMembershipPlan = {
    name,
    priceCents: priceCents as number,
    cycle: input.cycle as MembershipCycle,
    active: input.active === undefined ? true : input.active === true,
    benefits,
  };
  return { ok: true, value };
}

export function planDeletionRefusalMessage(
  result: Extract<MembershipPlanDeletionResult, { ok: false }>,
): string {
  switch (result.code) {
    case 'HAS_MEMBERSHIPS':
      return result.memberships === 1
        ? 'Este plano tem 1 assinante ativo ou com histórico. Para tirá-lo do clube sem cancelar quem já assinou, desative-o.'
        : `Este plano tem ${result.memberships} assinantes. Para tirá-lo do clube sem cancelar quem já assinou, desative-o.`;
    case 'NOT_FOUND':
      return 'Plano não encontrado.';
  }
}

// ---------------------------------------------------------------------------
// Núcleo de dados
// ---------------------------------------------------------------------------

const PLAN_SELECT = {
  id: true,
  name: true,
  priceCents: true,
  cycle: true,
  active: true,
  benefits: {
    select: {
      serviceId: true,
      quantityPerCycle: true,
      service: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.MembershipPlanSelect;

type PlanRow = Prisma.MembershipPlanGetPayload<{ select: typeof PLAN_SELECT }>;

function toPlanView(row: PlanRow): MembershipPlanView {
  return {
    id: row.id,
    name: row.name,
    priceCents: row.priceCents,
    cycle: row.cycle,
    active: row.active,
    benefits: row.benefits.map((benefit) => ({
      serviceId: benefit.serviceId,
      serviceName: benefit.service.name,
      quantityPerCycle: benefit.quantityPerCycle,
    })),
  };
}

/**
 * Dados graváveis do plano. `contractedPriceCents` não está aqui — nem poderia
 * estar: é campo de `Membership`, não de `MembershipPlan`. Este é o ponto que
 * garante que reajustar o plano não reajusta assinatura vigente.
 */
function writablePlanData(input: ValidatedMembershipPlan) {
  return {
    name: input.name,
    priceCents: input.priceCents,
    cycle: input.cycle,
    active: input.active,
  };
}

/**
 * Sincroniza os benefícios. Apaga e recria (volume pequeno, idempotente sob o
 * retry do client escopado). Só vincula serviços do PRÓPRIO tenant: ids de
 * outro salão ou inexistentes são descartados aqui, e a FK + RLS ainda cobrem o
 * caso de um id chegar por outro caminho.
 */
async function syncBenefits(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
  benefits: readonly ValidatedMembershipBenefit[],
): Promise<void> {
  await tx.membershipBenefit.deleteMany({ where: { tenantId, planId } });
  if (benefits.length === 0) return;

  const ownedServices = await tx.service.findMany({
    where: { tenantId, id: { in: benefits.map((benefit) => benefit.serviceId) } },
    select: { id: true },
  });
  if (ownedServices.length === 0) return;

  const ownedIds = new Set(ownedServices.map((service) => service.id));
  const rows = benefits.filter((benefit) => ownedIds.has(benefit.serviceId));
  if (rows.length === 0) return;

  await tx.membershipBenefit.createMany({
    data: rows.map((benefit) => ({
      tenantId,
      planId,
      serviceId: benefit.serviceId,
      quantityPerCycle: benefit.quantityPerCycle,
    })),
    skipDuplicates: true,
  });
}

export async function listPlans(
  tx: TenantTransaction,
  tenantId: string,
): Promise<MembershipPlanView[]> {
  const rows = await tx.membershipPlan.findMany({
    where: { tenantId },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    select: PLAN_SELECT,
  });
  return rows.map(toPlanView);
}

export async function getPlan(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
): Promise<MembershipPlanView | null> {
  const row = await tx.membershipPlan.findFirst({
    where: { id: planId, tenantId },
    select: PLAN_SELECT,
  });
  return row ? toPlanView(row) : null;
}

/** Serviços do tenant para montar os benefícios e validar a origem. */
export async function listPlanServiceOptions(
  tx: TenantTransaction,
  tenantId: string,
): Promise<PlanServiceOption[]> {
  const rows = await tx.service.findMany({
    where: { tenantId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, active: true },
  });
  return rows.map((row) => ({ id: row.id, name: row.name, active: row.active }));
}

export async function createPlan(
  tx: TenantTransaction,
  tenantId: string,
  input: ValidatedMembershipPlan,
): Promise<MembershipPlanView> {
  const created = await tx.membershipPlan.create({
    data: { tenantId, ...writablePlanData(input) },
    select: { id: true },
  });
  await syncBenefits(tx, tenantId, created.id, input.benefits);

  const view = await getPlan(tx, tenantId, created.id);
  if (!view) throw new Error('Plano recém-criado não encontrado');
  return view;
}

/**
 * Atualiza o plano. Devolve `null` quando ele não existe NESTE tenant (não vaza
 * existência). Assinaturas vigentes ficam intocadas: `contractedPriceCents` é
 * lido por quem cobra, e nenhuma escrita aqui o alcança.
 */
export async function updatePlan(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
  input: ValidatedMembershipPlan,
): Promise<MembershipPlanView | null> {
  const existing = await tx.membershipPlan.findFirst({
    where: { id: planId, tenantId },
    select: { id: true },
  });
  if (!existing) return null;

  await tx.membershipPlan.update({
    where: { id: planId },
    data: writablePlanData(input),
  });
  await syncBenefits(tx, tenantId, planId, input.benefits);
  return getPlan(tx, tenantId, planId);
}

export async function setPlanActive(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
  active: boolean,
): Promise<boolean> {
  const result = await tx.membershipPlan.updateMany({
    where: { id: planId, tenantId },
    data: { active },
  });
  return result.count > 0;
}

/**
 * Um plano com assinatura (de qualquer status) não é excluído: a FK
 * `membership -> membership_plan` é `ON DELETE RESTRICT` de propósito. Quem já
 * assinou é dono do preço contratado; apagar o plano levaria a assinatura e o
 * histórico junto. A saída é DESATIVAR.
 */
export async function assessPlanDeletion(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
): Promise<MembershipPlanDeletionAssessment | null> {
  const plan = await tx.membershipPlan.findFirst({
    where: { id: planId, tenantId },
    select: { id: true },
  });
  if (!plan) return null;

  const memberships = await tx.membership.count({ where: { tenantId, planId } });
  if (memberships > 0) return { canDelete: false, code: 'HAS_MEMBERSHIPS', memberships };
  return { canDelete: true, memberships: 0 };
}

export async function deletePlan(
  tx: TenantTransaction,
  tenantId: string,
  planId: string,
): Promise<MembershipPlanDeletionResult> {
  const assessment = await assessPlanDeletion(tx, tenantId, planId);
  if (!assessment) return { ok: false, code: 'NOT_FOUND', memberships: 0 };
  if (!assessment.canDelete) {
    return { ok: false, code: assessment.code, memberships: assessment.memberships };
  }

  await tx.membershipPlan.delete({ where: { id: planId } });
  return { ok: true };
}
