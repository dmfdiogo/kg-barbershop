'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import {
  createPlan,
  deletePlan,
  listPlanServiceOptions,
  planDeletionRefusalMessage,
  setPlanActive,
  updatePlan,
  validateMembershipPlanForm,
  type MembershipPlanActionResult,
  type MembershipPlanFieldErrors,
  type MembershipPlanFormInput,
  type MembershipPlanView,
} from '@/lib/membership/plans';

/**
 * Server actions dos planos do clube (tarefa F5.0).
 *
 * Toda ação revalida `requireRole('OWNER')`: o portão da tela barra a
 * navegação, mas esconder link não é controle de acesso — e a action é o
 * caminho que escreve. A validação é refeita aqui, com a lista de serviços do
 * PRÓPRIO tenant, que é o que impede um benefício apontar para serviço de outro
 * salão.
 *
 * A action é casca fina: o núcleo de dados fica em `lib/membership/plans.ts` e
 * recebe a transação escopada. Isolamento e retry da F0 continuam sendo o único
 * caminho até o banco.
 *
 * Nada aqui toca `Membership.contractedPriceCents`: reajustar o plano não
 * reajusta assinatura vigente. Quem cobra lê o preço contratado (F5.1).
 */

const CLUB_HOME_PATH = '/painel/clube';
const CLUB_PLANS_PATH = '/painel/clube/planos';

type OwnerContext = Awaited<ReturnType<typeof requireRole>>;
type OwnerGuard = { ok: true; context: OwnerContext } | { ok: false };

async function ownerOrForbidden(): Promise<OwnerGuard> {
  try {
    return { ok: true, context: await requireRole('OWNER') };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

function forbidden(): MembershipPlanActionResult {
  return { ok: false, code: 'FORBIDDEN', message: 'Você não tem acesso a esta área.' };
}

function invalid(fieldErrors: MembershipPlanFieldErrors): MembershipPlanActionResult {
  return {
    ok: false,
    code: 'INVALID',
    message: 'Verifique os campos destacados.',
    fieldErrors,
  };
}

type SaveOutcome =
  | { ok: true; plan: MembershipPlanView }
  | { ok: false; fieldErrors: MembershipPlanFieldErrors }
  | { ok: false; notFound: true };

export async function createPlanAction(
  input: MembershipPlanFormInput,
): Promise<MembershipPlanActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const outcome = await auth.context.forTenant<SaveOutcome>(async (tx) => {
    const services = await listPlanServiceOptions(tx, auth.context.tenant.id);
    const validation = validateMembershipPlanForm(
      input,
      new Set(services.map((service) => service.id)),
    );
    if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };

    const plan = await createPlan(tx, auth.context.tenant.id, validation.value);
    return { ok: true, plan };
  });

  if (!outcome.ok) {
    return 'notFound' in outcome
      ? { ok: false, code: 'NOT_FOUND', message: 'Plano não encontrado.' }
      : invalid(outcome.fieldErrors);
  }

  revalidatePath(CLUB_PLANS_PATH);
  revalidatePath(CLUB_HOME_PATH);
  return { ok: true, plan: outcome.plan };
}

export async function updatePlanAction(
  planId: string,
  input: MembershipPlanFormInput,
): Promise<MembershipPlanActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const outcome = await auth.context.forTenant<SaveOutcome>(async (tx) => {
    const services = await listPlanServiceOptions(tx, auth.context.tenant.id);
    const validation = validateMembershipPlanForm(
      input,
      new Set(services.map((service) => service.id)),
    );
    if (!validation.ok) return { ok: false, fieldErrors: validation.fieldErrors };

    const plan = await updatePlan(tx, auth.context.tenant.id, planId, validation.value);
    if (!plan) return { ok: false, notFound: true };
    return { ok: true, plan };
  });

  if (!outcome.ok) {
    return 'notFound' in outcome
      ? { ok: false, code: 'NOT_FOUND', message: 'Plano não encontrado.' }
      : invalid(outcome.fieldErrors);
  }

  revalidatePath(CLUB_PLANS_PATH);
  revalidatePath(CLUB_HOME_PATH);
  return { ok: true, plan: outcome.plan };
}

export async function setPlanActiveAction(
  planId: string,
  active: boolean,
): Promise<MembershipPlanActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const changed = await auth.context.forTenant((tx) =>
    setPlanActive(tx, auth.context.tenant.id, planId, active),
  );
  if (!changed) {
    return { ok: false, code: 'NOT_FOUND', message: 'Plano não encontrado.' };
  }

  revalidatePath(CLUB_PLANS_PATH);
  revalidatePath(CLUB_HOME_PATH);
  return { ok: true, deactivated: !active };
}

export async function deletePlanAction(planId: string): Promise<MembershipPlanActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const result = await auth.context.forTenant((tx) =>
    deletePlan(tx, auth.context.tenant.id, planId),
  );
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: planDeletionRefusalMessage(result),
      memberships: result.memberships,
    };
  }

  revalidatePath(CLUB_PLANS_PATH);
  revalidatePath(CLUB_HOME_PATH);
  return { ok: true };
}
