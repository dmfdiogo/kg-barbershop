'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole, type RequestContext } from '@/lib/auth/rbac';
import {
  savePortalAddressAction,
  type PortalAddressActionResult,
} from '@/app/(dashboard)/painel/configuracoes/actions';
import {
  ensureOwnerStaffProfile,
  loadOnboarding,
  markStepComplete,
  saveEstablishment,
  type OnboardingView,
} from './service';
import { isOnboardingStep } from './steps';
import { validateEstablishment, type EstablishmentFieldErrors } from './validation';

/**
 * Server actions do onboarding guiado (tarefa F2.5).
 *
 * Cascas finas: revalidam `requireRole('OWNER')` e delegam ao núcleo
 * (`./service`) ou às server actions das folhas. Nenhuma regra de jornada,
 * serviço ou marca é reescrita aqui — o onboarding é um CAMINHO por cima delas.
 *
 * O `tenantId` nunca vem do formulário: sai de `requireRole`, que lê o membro do
 * tenant ativo da sessão. Um dono do salão A não escreve no salão B nem
 * forjando o id.
 */

export type EstablishmentActionResult =
  | { ok: true; onboarding: OnboardingView }
  | { ok: false; code: 'FORBIDDEN'; message: string }
  | {
      ok: false;
      code: 'INVALID';
      message: string;
      fieldErrors: EstablishmentFieldErrors;
    };

export type CompleteStepResult =
  | { ok: true }
  | { ok: false; code: 'FORBIDDEN' | 'INVALID'; message: string };

const ONBOARDING_PATH = '/painel/onboarding';

async function ownerOrNull(): Promise<RequestContext | null> {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

export async function saveEstablishmentAction(
  input: unknown,
): Promise<EstablishmentActionResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono configura o estabelecimento.' };
  }

  const validation = validateEstablishment((input ?? {}) as Record<string, unknown>);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const onboarding = await context.forTenant(async (tx) => {
    await saveEstablishment(
      tx,
      context.tenant.id,
      context.user.id,
      validation.value,
      context.member.id,
    );
    return loadOnboarding(tx, context.tenant.id);
  });

  revalidatePath(ONBOARDING_PATH);
  revalidatePath('/painel');
  return { ok: true, onboarding };
}

/**
 * Garante o perfil de profissional do dono (idempotente). Usado pelo passo de
 * expediente quando o dono chegou lá sem passar pelo passo de estabelecimento
 * (ex.: retomou a URL direto) e não tem perfil para pendurar a jornada.
 */
export async function ensureOwnerProfileAction(): Promise<CompleteStepResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono prepara a agenda.' };
  }

  await context.forTenant((tx) =>
    ensureOwnerStaffProfile(tx, context.tenant.id, context.member.id),
  );
  revalidatePath(ONBOARDING_PATH);
  return { ok: true };
}

export async function completeOnboardingStepAction(step: string): Promise<CompleteStepResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono avança o onboarding.' };
  }
  if (!isOnboardingStep(step)) {
    return { ok: false, code: 'INVALID', message: 'Passo de onboarding inválido.' };
  }

  await context.forTenant((tx) => markStepComplete(tx, context.tenant.id, step));
  revalidatePath(ONBOARDING_PATH);
  return { ok: true };
}

/**
 * Salva o endereço do portal REUSANDO a action da F2.4 (`savePortalAddress`) e
 * só então marca o passo como concluído. A validação de slug, a recusa de
 * reservado e a checagem de Pro continuam sendo as da folha — uma cópia aqui
 * divergiria da F2.4 no dia seguinte.
 */
export async function saveOnboardingPortalAction(input: {
  slug: unknown;
  customDomain: unknown;
}): Promise<PortalAddressActionResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono edita o endereço do portal.' };
  }

  const result = await savePortalAddressAction(input);
  if (!result.ok) return result;

  await context.forTenant((tx) => markStepComplete(tx, context.tenant.id, 'PORTAL'));
  revalidatePath(ONBOARDING_PATH);
  return result;
}
