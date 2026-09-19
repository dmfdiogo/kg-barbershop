import type { TenantContext } from '@/lib/tenant/context';
import { CancelBookingError, cancelBooking } from '@/lib/booking/cancel';
import { RescheduleBookingError, rescheduleBooking } from '@/lib/booking/reschedule';
import { HoldError } from '@/lib/booking/hold';
import { isSlotUnavailableError } from '@/lib/tenant/errors';
import { buildSlotOptions, dayOfInstant, loadDayState } from '../../agendar/_lib/availability';
import type { AccountActionResult, AccountErrorCode, AccountSlot } from './types';

/**
 * Orquestração da área do cliente (F3.4), sem runtime do Next: os server
 * actions são casca de sessão/cookies e delegam para cá, o que torna o fluxo
 * testável contra Postgres real.
 *
 * Nenhum erro de domínio vira 500. "Fora da janela" é fluxo esperado e tem
 * código próprio; o genérico cai em CONFLICT e é registrado no servidor.
 */

function fail(code: AccountErrorCode, message: string): AccountActionResult<never> {
  return { ok: false, code, message };
}

export interface ManageParams {
  ctx: TenantContext;
  memberId: string;
  bookingId: string;
  now?: Date;
}

export interface CancelledInfo {
  bookingId: string;
  alreadyCancelled: boolean;
}

/** Cancela pelo cliente logado, aplicando a janela do tenant. */
export async function cancelCustomerBooking(
  params: ManageParams & { userId: string | null },
): Promise<AccountActionResult<CancelledInfo>> {
  const { ctx, memberId, bookingId, userId } = params;

  try {
    const result = await cancelBooking({
      tenantId: ctx.tenant.id,
      bookingId,
      customerId: memberId,
      cancelledBy: userId,
      reason: 'Cancelled by customer',
      now: params.now,
    });
    return {
      ok: true,
      value: { bookingId: result.booking.id, alreadyCancelled: result.alreadyCancelled },
    };
  } catch (error) {
    if (error instanceof CancelBookingError) return fail(error.code, error.message);
    console.error('[minha-conta] erro inesperado ao cancelar', error);
    return fail('CONFLICT', 'Não foi possível cancelar agora. Tente novamente.');
  }
}

export interface RescheduleParams {
  ctx: TenantContext;
  memberId: string;
  bookingId: string;
  /** Novo horário (UTC). */
  startsAt: Date;
  /** Dono do hold novo; na área logada, a própria identidade do cliente serve. */
  holdSessionId: string;
  now?: Date;
}

export interface RescheduledInfo {
  bookingId: string;
  previousBookingId: string;
}

/** Remarca pelo cliente logado: libera o antigo e confirma o novo, atômico. */
export async function rescheduleCustomerBooking(
  params: RescheduleParams,
): Promise<AccountActionResult<RescheduledInfo>> {
  const { ctx, memberId, bookingId, startsAt, holdSessionId } = params;
  const now = params.now ?? new Date();

  try {
    // Checagem de grade: o novo horário precisa ser OFERTADO para o serviço e o
    // profissional do agendamento. É a mesma defesa do fluxo de agendamento —
    // a garantia real contra duplicidade continua sendo a exclusion constraint,
    // mas sem isto um cliente poderia remarcar para um horário inexistente.
    const booking = await ctx.forTenant((tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, tenantId: ctx.tenant.id },
        select: { serviceId: true, staffId: true, customerId: true },
      }),
    );
    if (!booking || booking.customerId !== memberId) {
      return fail('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }

    const date = dayOfInstant(startsAt, ctx.tenant.timezone);
    const loaded = await loadDayState(ctx, booking.serviceId, booking.staffId, date);
    const offered =
      loaded !== null &&
      buildSlotOptions(loaded, now).some((slot) => slot.value === startsAt.toISOString());
    if (!offered) {
      return fail('SLOT_UNAVAILABLE', 'Horário indisponível. Escolha outro.');
    }

    const result = await rescheduleBooking({
      tenantId: ctx.tenant.id,
      bookingId,
      customerId: memberId,
      newStartsAt: startsAt,
      holdSessionId,
      reason: 'Rescheduled by customer',
      now,
    });
    return {
      ok: true,
      value: { bookingId: result.booking.id, previousBookingId: result.previous.id },
    };
  } catch (error) {
    if (error instanceof RescheduleBookingError) return fail(error.code, error.message);
    if (isSlotUnavailableError(error)) {
      return fail('SLOT_UNAVAILABLE', 'O horário acabou de ser reservado. Escolha outro.');
    }
    if (error instanceof HoldError) {
      return fail(error.code, error.message);
    }
    console.error('[minha-conta] erro inesperado ao remarcar', error);
    return fail('CONFLICT', 'Não foi possível remarcar agora. Tente novamente.');
  }
}

export interface RescheduleSlotsParams {
  ctx: TenantContext;
  memberId: string;
  bookingId: string;
  /** Dia local do tenant, "YYYY-MM-DD". */
  date: string;
  now?: Date;
}

/**
 * Horários livres para o novo dia da remarcação, do MESMO serviço e
 * profissional do agendamento. Reusa a grade da F3.1 — não há cálculo paralelo.
 */
export async function loadRescheduleSlots(
  params: RescheduleSlotsParams,
): Promise<AccountActionResult<AccountSlot[]>> {
  const { ctx, memberId, bookingId, date } = params;
  const now = params.now ?? new Date();

  try {
    const booking = await ctx.forTenant((tx) =>
      tx.booking.findFirst({
        where: { id: bookingId, tenantId: ctx.tenant.id },
        select: { serviceId: true, staffId: true, customerId: true },
      }),
    );

    if (!booking || booking.customerId !== memberId) {
      return fail('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }

    const loaded = await loadDayState(ctx, booking.serviceId, booking.staffId, date);
    if (!loaded) {
      return fail('CONFLICT', 'Não foi possível carregar os horários.');
    }

    return { ok: true, value: buildSlotOptions(loaded, now) };
  } catch (error) {
    console.error('[minha-conta] erro inesperado ao carregar horários', error);
    return fail('CONFLICT', 'Não foi possível carregar os horários.');
  }
}
