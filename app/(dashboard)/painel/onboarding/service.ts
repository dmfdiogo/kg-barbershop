import type { OnboardingStep, PayoutStatus } from '@prisma/client';
import { recordAuditLog } from '@/lib/audit/record';
import { auditAction } from '@/lib/audit/types';
import type { TenantTransaction } from '@/lib/tenant/db';
import { firstIncompleteStep, ONBOARDING_STEP_ORDER, type OnboardingStepKey } from './steps';
import type { ValidatedEstablishment } from './validation';

/**
 * Núcleo de dados do onboarding (tarefa F2.5).
 *
 * Recebe a transação JÁ escopada por `context.forTenant()`: não abre transação,
 * não conhece `next/*` e é reexecutável sob retry. Tudo aqui reusa os dados das
 * folhas — o estabelecimento escreve em `Tenant`, a chave Pix fica em
 * `OnboardingProgress` aguardando a F4.1, e jornada/serviço continuam sendo
 * escritos pelas server actions da F2.1/F2.2, nunca por uma cópia local.
 *
 * O progresso é EXPLÍCITO (uma linha por tenant), não derivado do que já
 * existe: o dono que volta para corrigir o nome não deve pular de etapa só
 * porque já tem jornada e serviço cadastrados.
 */

export interface OnboardingView {
  name: string;
  document: string;
  slug: string;
  pixKey: string | null;
  payoutStatus: PayoutStatus;
  completedSteps: OnboardingStepKey[];
  /** Próximo passo a fazer; `null` quando os quatro estão completos. */
  currentStep: OnboardingStepKey | null;
}

function asStepKeys(steps: readonly OnboardingStep[]): OnboardingStepKey[] {
  return steps.filter((step): step is OnboardingStepKey =>
    (ONBOARDING_STEP_ORDER as readonly string[]).includes(step),
  );
}

export async function loadOnboarding(
  tx: TenantTransaction,
  tenantId: string,
): Promise<OnboardingView> {
  // Sequencial de propósito: o adapter-pg não gosta de queries concorrentes na
  // mesma transação interativa (nota em `lib/tenant/db.ts`).
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { name: true, document: true, slug: true },
  });
  const progress = await tx.onboardingProgress.findUnique({
    where: { tenantId },
    select: { completedSteps: true, pixKey: true, payoutStatus: true },
  });

  const completedSteps = asStepKeys(progress?.completedSteps ?? []);
  return {
    name: tenant.name,
    document: tenant.document,
    slug: tenant.slug,
    pixKey: progress?.pixKey ?? null,
    payoutStatus: progress?.payoutStatus ?? 'AWAITING_ACTIVATION',
    completedSteps,
    currentStep: firstIncompleteStep(completedSteps),
  };
}

/**
 * Grava o passo "estabelecimento": nome e documento vão para `Tenant`, a chave
 * Pix fica em `OnboardingProgress` com estado `AWAITING_ACTIVATION` (a criação
 * da subconta é da F4). Também garante o `StaffProfile` do dono, para que o
 * passo de expediente seguinte tenha onde pendurar a jornada — o dono costuma
 * ser o primeiro profissional do salão.
 */
export async function saveEstablishment(
  tx: TenantTransaction,
  tenantId: string,
  actorId: string,
  value: ValidatedEstablishment,
  ownerMemberId: string,
): Promise<void> {
  await tx.tenant.update({
    where: { id: tenantId },
    data: { name: value.name, document: value.document },
  });

  await tx.onboardingProgress.upsert({
    where: { tenantId },
    create: {
      tenantId,
      completedSteps: ['ESTABLISHMENT'],
      pixKey: value.pixKey,
      payoutStatus: 'AWAITING_ACTIVATION',
    },
    update: {
      pixKey: value.pixKey,
      payoutStatus: 'AWAITING_ACTIVATION',
    },
  });

  await ensureOwnerStaffProfile(tx, tenantId, ownerMemberId);
  await markStepComplete(tx, tenantId, 'ESTABLISHMENT');

  await recordAuditLog(tx, {
    tenantId,
    actorId,
    action: auditAction('OnboardingProgress', 'establishment_save'),
    entity: 'OnboardingProgress',
    entityId: tenantId,
  });
}

/**
 * Marca um passo como concluído, de forma idempotente. A lista é normalizada na
 * ordem canônica para que a leitura não dependa da ordem de escrita.
 */
export async function markStepComplete(
  tx: TenantTransaction,
  tenantId: string,
  step: OnboardingStepKey,
): Promise<void> {
  const current = await tx.onboardingProgress.findUnique({
    where: { tenantId },
    select: { completedSteps: true },
  });
  const done = new Set<OnboardingStepKey>(asStepKeys(current?.completedSteps ?? []));
  done.add(step);

  const completedSteps = ONBOARDING_STEP_ORDER.filter((entry) => done.has(entry));
  const allDone = completedSteps.length === ONBOARDING_STEP_ORDER.length;

  await tx.onboardingProgress.upsert({
    where: { tenantId },
    create: { tenantId, completedSteps, completedAt: allDone ? new Date() : null },
    update: { completedSteps, completedAt: allDone ? new Date() : null },
  });
}

/**
 * Garante que o dono tenha um `StaffProfile` — é onde a jornada é pendurada. A
 * operação é idempotente: `tenantMemberId` é único, então reexecutar sob retry
 * não cria um segundo perfil.
 */
export async function ensureOwnerStaffProfile(
  tx: TenantTransaction,
  tenantId: string,
  ownerMemberId: string,
): Promise<string> {
  const existing = await tx.staffProfile.findUnique({
    where: { tenantMemberId: ownerMemberId },
    select: { id: true, tenantId: true },
  });
  if (existing && existing.tenantId === tenantId) return existing.id;

  const created = await tx.staffProfile.create({
    data: { tenantId, tenantMemberId: ownerMemberId },
    select: { id: true },
  });
  return created.id;
}

/** Jornada sugerida quando o dono ainda não tem nenhuma: seg–sex, 09:00–18:00. */
export function defaultWeeklyHours(): { weekday: number; startTime: string; endTime: string }[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startTime: '09:00',
    endTime: '18:00',
  }));
}
