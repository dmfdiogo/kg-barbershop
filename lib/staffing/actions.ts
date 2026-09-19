'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole, type RequestContext } from '@/lib/auth/rbac';
import {
  createTimeOff,
  deleteTimeOff,
  inviteStaff,
  replaceStaffServices,
  replaceWeeklySchedule,
  setStaffActive,
  updateStaffBio,
} from './members';
import {
  validateInviteForm,
  validateStaffServices,
  validateTimeOffForm,
  validateWeeklySchedule,
} from './validation';
import type {
  InviteFormInput,
  InviteMemberResult,
  StaffMutationResult,
  StaffServicesFormInput,
  StaffServicesResult,
  StaffingFailure,
  TimeOffFormInput,
  TimeOffResult,
  WeeklyScheduleFormInput,
  WeeklyScheduleResult,
} from './types';

/**
 * Server actions da equipe (tarefa F2.2).
 *
 * Toda ação revalida `requireRole('OWNER')`: o portão da tela barra a
 * navegação, mas esconder link não é controle de acesso — a autorização
 * precisa valer na action, que é o caminho que escreve. Staff não gerencia a
 * própria equipe: o `requireRole('OWNER')` recusa antes de qualquer validação.
 *
 * As actions são cascas finas; o núcleo de dados fica em `./members`, que
 * recebe a transação escopada. Validação e decisão de conflito são refeitas
 * aqui — o cliente nunca dita o que vai ao banco.
 */

const EQUIPE_PATH = '/painel/equipe';

type Auth = { ok: true; context: RequestContext } | { ok: false };

async function ownerOrForbidden(): Promise<Auth> {
  try {
    return { ok: true, context: await requireRole('OWNER') };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

function forbidden(): StaffingFailure {
  return { ok: false, code: 'FORBIDDEN', message: 'Você não tem acesso a esta área.' };
}

function revalidateStaff(staffId: string): void {
  revalidatePath(EQUIPE_PATH);
  revalidatePath(`${EQUIPE_PATH}/${staffId}`);
}

export async function inviteStaffAction(input: InviteFormInput): Promise<InviteMemberResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateInviteForm(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await auth.context.forTenant((tx) =>
    inviteStaff(tx, auth.context.tenant.id, validation.value),
  );
  if (result.ok) revalidatePath(EQUIPE_PATH);
  return result;
}

export async function saveWeeklyScheduleAction(
  staffId: string,
  input: WeeklyScheduleFormInput,
): Promise<WeeklyScheduleResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateWeeklySchedule(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await auth.context.forTenant((tx) =>
    replaceWeeklySchedule(tx, auth.context.tenant.id, staffId, validation.value, auth.context.tenant.timezone, {
      confirmConflicts: input.confirmConflicts === true,
    }),
  );
  if (result.ok) revalidateStaff(staffId);
  return result;
}

export async function createTimeOffAction(
  staffId: string,
  input: TimeOffFormInput,
): Promise<TimeOffResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateTimeOffForm(input, auth.context.tenant.timezone);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await auth.context.forTenant((tx) =>
    createTimeOff(tx, auth.context.tenant.id, staffId, validation.value, {
      confirmConflicts: input.confirmConflicts === true,
    }),
  );
  if (result.ok) revalidateStaff(staffId);
  return result;
}

export async function deleteTimeOffAction(
  staffId: string,
  timeOffId: string,
): Promise<StaffMutationResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const deleted = await auth.context.forTenant((tx) =>
    deleteTimeOff(tx, auth.context.tenant.id, staffId, timeOffId),
  );
  if (!deleted) {
    return { ok: false, code: 'NOT_FOUND', message: 'Bloqueio não encontrado.' };
  }
  revalidateStaff(staffId);
  return { ok: true };
}

export async function saveStaffServicesAction(
  staffId: string,
  input: StaffServicesFormInput,
): Promise<StaffServicesResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const validation = validateStaffServices(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await auth.context.forTenant((tx) =>
    replaceStaffServices(tx, auth.context.tenant.id, staffId, validation.serviceIds),
  );
  if (result.ok) revalidateStaff(staffId);
  return result;
}

export async function setStaffActiveAction(
  staffId: string,
  active: boolean,
): Promise<StaffMutationResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const changed = await auth.context.forTenant((tx) =>
    setStaffActive(tx, auth.context.tenant.id, staffId, active),
  );
  if (!changed) {
    return { ok: false, code: 'NOT_FOUND', message: 'Profissional não encontrado.' };
  }
  revalidateStaff(staffId);
  return { ok: true };
}

export async function updateStaffBioAction(
  staffId: string,
  bio: string,
): Promise<StaffMutationResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();

  const trimmed = typeof bio === 'string' ? bio.trim() : '';
  if (trimmed.length > 280) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'A bio deve ter até 280 caracteres.',
      fieldErrors: { name: 'A bio deve ter até 280 caracteres.' },
    };
  }

  const changed = await auth.context.forTenant((tx) =>
    updateStaffBio(tx, auth.context.tenant.id, staffId, trimmed),
  );
  if (!changed) {
    return { ok: false, code: 'NOT_FOUND', message: 'Profissional não encontrado.' };
  }
  revalidateStaff(staffId);
  return { ok: true };
}
