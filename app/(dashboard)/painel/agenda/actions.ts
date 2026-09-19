'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole, type RequestContext } from '@/lib/auth/rbac';
import {
  createWalkIn,
  markBookingCompleted,
  markBookingNoShow,
  resolveAgendaScope,
} from './_lib/agenda';
import { validateWalkInForm } from './_lib/validation';
import type {
  AgendaFailure,
  BookingStampResult,
  WalkInFormInput,
  WalkInResult,
} from './_lib/types';

/**
 * Server actions da agenda (tarefa F3.5).
 *
 * Toda ação revalida `requireRole('STAFF')` e resolve o escopo no servidor: o
 * portão da tela barra a navegação, mas esconder link/rota não é controle de
 * acesso. Para o STAFF, `ownStaffId` é o próprio `StaffProfile` e o walk-in é
 * forçado para ele — enviar o id de um colega no formulário não muda o dono.
 * Para o OWNER, `ownStaffId` é nulo e ele pode operar em qualquer profissional
 * do tenant.
 *
 * As actions são cascas finas; o núcleo de dados fica em `./_lib/agenda`, que
 * recebe a transação escopada. O cliente nunca dita o que vai ao banco.
 */

const AGENDA_PATH = '/painel/agenda';

type Auth =
  | { ok: true; context: RequestContext; ownStaffId: string | null }
  | { ok: false };

async function staffOrForbidden(): Promise<Auth> {
  try {
    const context = await requireRole('STAFF');
    const scope = await context.forTenant((tx) =>
      resolveAgendaScope(tx, context.tenant.id, context.role, context.member.id, null),
    );
    if (!scope) return { ok: false };
    return { ok: true, context, ownStaffId: scope.ownStaffId };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

function forbidden(): AgendaFailure {
  return { ok: false, code: 'FORBIDDEN', message: 'Você não tem acesso a esta área.' };
}

export async function markCompletedAction(bookingId: string): Promise<BookingStampResult> {
  const auth = await staffOrForbidden();
  if (!auth.ok) return forbidden();

  const result = await auth.context.forTenant((tx) =>
    markBookingCompleted(tx, auth.context.tenant.id, bookingId, {
      allowedStaffId: auth.ownStaffId,
    }),
  );
  if (result.ok) revalidatePath(AGENDA_PATH);
  return result;
}

export async function markNoShowAction(bookingId: string): Promise<BookingStampResult> {
  const auth = await staffOrForbidden();
  if (!auth.ok) return forbidden();

  const result = await auth.context.forTenant((tx) =>
    markBookingNoShow(tx, auth.context.tenant.id, bookingId, {
      allowedStaffId: auth.ownStaffId,
    }),
  );
  if (result.ok) revalidatePath(AGENDA_PATH);
  return result;
}

export async function createWalkInAction(input: WalkInFormInput): Promise<WalkInResult> {
  const auth = await staffOrForbidden();
  if (!auth.ok) return forbidden();

  // O STAFF só cria para si; o campo do formulário é ignorado quando há escopo.
  const normalized: WalkInFormInput = auth.ownStaffId
    ? { ...input, staffId: auth.ownStaffId }
    : input;

  const validation = validateWalkInForm(normalized, auth.context.tenant.timezone);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await createWalkIn({
    tenantId: auth.context.tenant.id,
    ...validation.value,
  });
  if (result.ok) revalidatePath(AGENDA_PATH);
  return result;
}
