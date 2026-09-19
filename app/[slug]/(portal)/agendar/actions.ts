'use server';

import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import { requireTenantContext, TenantUnavailableError } from '@/lib/tenant/context';
import { isSlotUnavailableError } from '@/lib/tenant/errors';
import { buildSlotOptions, loadDayState } from './_lib/availability';
import { confirmCustomerHold, createBookingHold, PortalBookingError } from './_lib/booking-flow';
import { getOrCreateBookingSessionId, readBookingSessionId } from './_lib/booking-session';
import type { ActionResult, BookingErrorCode, ConfirmedInfo, HoldInfo, SlotOption } from './_lib/types';

/**
 * Server actions do fluxo de agendamento (F3.3).
 *
 * Casca fina: resolvem o tenant da requisição (nunca por parâmetro vindo do
 * cliente), leem a sessão/cookie e delegam para o domínio em `_lib`. Nenhum
 * erro de fluxo sobe como 500: "horário tomado" e "reserva liberada" são
 * estados esperados, com mensagem própria — a grade recarrega e o cliente
 * escolhe outro.
 */

function fail(code: BookingErrorCode, message: string): ActionResult<never> {
  return { ok: false, code, message };
}

/**
 * Traduz erro de domínio em resultado. Erro inesperado vira `CONFLICT` genérico
 * e é registrado no servidor: o cliente final nunca vê um 500 de um fluxo que
 * descobriu tarde demais que não podia concluir. Bug de verdade continua
 * aparecendo nos testes de integração, que chamam o domínio direto.
 */
function toFailure(error: unknown): ActionResult<never> {
  if (error instanceof PortalBookingError) return fail(error.code, error.message);
  if (error instanceof TenantUnavailableError) return fail('TENANT_UNAVAILABLE', error.message);
  if (isSlotUnavailableError(error)) {
    return fail('SLOT_UNAVAILABLE', 'O horário acabou de ser reservado. Escolha outro.');
  }
  console.error('[agendar] erro inesperado no fluxo de agendamento', error);
  return fail('CONFLICT', 'Não foi possível concluir agora. Tente novamente.');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

interface LoadAvailabilityInput {
  serviceId: string;
  staffId: string | null;
  date: string;
}

export async function loadAvailabilityAction(
  input: LoadAvailabilityInput,
): Promise<ActionResult<SlotOption[]>> {
  const serviceId = asString(input?.serviceId);
  const date = asString(input?.date);
  const staffId = input?.staffId == null ? null : asString(input.staffId);
  if (!serviceId || !date) return fail('INVALID_INPUT', 'Dados de agenda inválidos.');

  try {
    const ctx = await requireTenantContext();
    const loaded = await loadDayState(ctx, serviceId, staffId, date);
    if (!loaded) return fail('SERVICE_NOT_FOUND', 'Serviço não encontrado.');
    return { ok: true, value: buildSlotOptions(loaded, new Date()) };
  } catch (error) {
    return toFailure(error);
  }
}

interface CreateHoldActionInput {
  serviceId: string;
  staffId: string | null;
  startsAt: string;
}

export async function createHoldAction(
  input: CreateHoldActionInput,
): Promise<ActionResult<HoldInfo>> {
  const serviceId = asString(input?.serviceId);
  const startsAtRaw = asString(input?.startsAt);
  const staffId = input?.staffId == null ? null : asString(input.staffId);
  if (!serviceId || !startsAtRaw) return fail('INVALID_INPUT', 'Dados do agendamento inválidos.');

  const startsAt = new Date(startsAtRaw);
  if (Number.isNaN(startsAt.getTime())) return fail('INVALID_INPUT', 'Horário inválido.');

  try {
    const ctx = await requireTenantContext();

    // Sessão do dispositivo: dona do hold. Sem ela, um bot segura a agenda.
    const holdSessionId = await getOrCreateBookingSessionId();

    // Sessão ativa identifica o cliente já no hold e dispensa o OTP. Sem
    // sessão, o hold nasce anônimo (`customerId` nulo) — não há mais cliente
    // fantasma; o vínculo é gravado na confirmação, depois do OTP.
    const session = await getSession();
    let customerId: string | null = null;
    if (session) {
      const member = await getMembership(ctx.tenant.id, session.userId);
      customerId = member?.id ?? null;
    }
    const authenticated = customerId !== null;

    const value = await createBookingHold({
      ctx,
      serviceId,
      staffId,
      startsAt,
      customerId,
      holdSessionId,
      authenticated,
    });
    return { ok: true, value };
  } catch (error) {
    return toFailure(error);
  }
}

interface ConfirmBookingActionInput {
  holdId: string;
}

export async function confirmBookingAction(
  input: ConfirmBookingActionInput,
): Promise<ActionResult<ConfirmedInfo>> {
  const holdId = asString(input?.holdId);
  if (!holdId) return fail('INVALID_INPUT', 'Dados da confirmação inválidos.');

  try {
    const ctx = await requireTenantContext();
    const session = await getSession();
    if (!session) return fail('UNAUTHENTICATED', 'Confirme seu código para concluir o agendamento.');

    const member = await getMembership(ctx.tenant.id, session.userId);
    if (!member) return fail('UNAUTHENTICATED', 'Entre para confirmar seu agendamento.');

    const holdSessionId = await readBookingSessionId();
    if (!holdSessionId) return fail('CONFLICT', 'Recomece a reserva do horário.');

    const value = await confirmCustomerHold({
      ctx,
      holdId,
      holdSessionId,
      memberId: member.id,
    });
    return { ok: true, value };
  } catch (error) {
    return toFailure(error);
  }
}
