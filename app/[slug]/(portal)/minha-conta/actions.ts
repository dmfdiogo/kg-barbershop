'use server';

import { revalidatePath } from 'next/cache';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import { requireTenantContext, TenantUnavailableError, type TenantContext } from '@/lib/tenant/context';
import {
  cancelCustomerBooking,
  loadRescheduleSlots,
  rescheduleCustomerBooking,
} from './_lib/account-flow';
import type { AccountActionResult, AccountErrorCode } from './_lib/types';

/**
 * Server actions da área do cliente (F3.4).
 *
 * Casca fina: resolvem o tenant da requisição (nunca por parâmetro do cliente),
 * provam a identidade pela sessão + `TenantMember`, e delegam para o domínio em
 * `_lib`. O cliente nunca passa o próprio id — ele vem do banco. É o que impede
 * um cliente cancelar o agendamento de outro.
 */

function fail<T>(code: AccountErrorCode, message: string): AccountActionResult<T> {
  return { ok: false, code, message };
}

interface Actor {
  ctx: TenantContext;
  memberId: string;
  userId: string;
}

type ActorResolution = { ok: true; actor: Actor } | { ok: false; error: AccountActionResult<never> };

async function resolveActor(): Promise<ActorResolution> {
  try {
    const ctx = await requireTenantContext();
    const session = await getSession();
    if (!session) {
      return { ok: false, error: fail('UNAUTHENTICATED', 'Entre para ver seus agendamentos.') };
    }
    const member = await getMembership(ctx.tenant.id, session.userId);
    if (!member) {
      return { ok: false, error: fail('UNAUTHENTICATED', 'Entre para ver seus agendamentos.') };
    }
    return { ok: true, actor: { ctx, memberId: member.id, userId: session.userId } };
  } catch (error) {
    if (error instanceof TenantUnavailableError) {
      return { ok: false, error: fail('TENANT_UNAVAILABLE', error.message) };
    }
    throw error;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function revalidatePortal(ctx: TenantContext): void {
  revalidatePath(`/${ctx.tenant.slug}/minha-conta`);
  revalidatePath('/minha-conta');
}

export async function cancelBookingAction(input: {
  bookingId: string;
}): Promise<AccountActionResult<{ bookingId: string; alreadyCancelled: boolean }>> {
  const bookingId = asString(input?.bookingId);
  if (!bookingId) return fail('INVALID_INPUT', 'Agendamento inválido.');

  const resolved = await resolveActor();
  if (!resolved.ok) return resolved.error;
  const { ctx, memberId, userId } = resolved.actor;

  const result = await cancelCustomerBooking({ ctx, memberId, userId, bookingId });
  if (result.ok) revalidatePortal(ctx);
  return result;
}

export async function rescheduleBookingAction(input: {
  bookingId: string;
  startsAt: string;
}): Promise<AccountActionResult<{ bookingId: string; previousBookingId: string }>> {
  const bookingId = asString(input?.bookingId);
  const startsAtRaw = asString(input?.startsAt);
  if (!bookingId || !startsAtRaw) return fail('INVALID_INPUT', 'Dados da remarcação inválidos.');

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) return fail('INVALID_INPUT', 'Horário inválido.');

  const resolved = await resolveActor();
  if (!resolved.ok) return resolved.error;
  const { ctx, memberId } = resolved.actor;

  // O hold é criado e confirmado na MESMA transação (lib/booking/reschedule);
  // o dono do hold é a identidade já provada, não um dispositivo anônimo.
  const result = await rescheduleCustomerBooking({
    ctx,
    memberId,
    bookingId,
    startsAt,
    holdSessionId: memberId,
  });
  if (result.ok) revalidatePortal(ctx);
  return result;
}

export async function loadRescheduleSlotsAction(input: {
  bookingId: string;
  date: string;
}): Promise<AccountActionResult<{ value: string; label: string }[]>> {
  const bookingId = asString(input?.bookingId);
  const date = asString(input?.date);
  if (!bookingId || !date) return fail('INVALID_INPUT', 'Dados de agenda inválidos.');

  const resolved = await resolveActor();
  if (!resolved.ok) return resolved.error;
  const { ctx, memberId } = resolved.actor;

  return loadRescheduleSlots({ ctx, memberId, bookingId, date });
}
