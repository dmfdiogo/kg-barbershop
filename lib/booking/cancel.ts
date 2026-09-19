import type { Booking } from '@prisma/client';
import { forTenant } from '@/lib/tenant/db';
import { isWithinCancellationWindow } from './availability';
import {
  emitBookingEvent,
  type BookingCancelledEvent,
  type BookingEventHandler,
} from './confirm';

/**
 * Cancelamento do agendamento (tarefa F3.4).
 *
 * A regra que o cliente sente na pele: só dá para cancelar até
 * `Tenant.cancellationWindowHours` antes do atendimento. A janela é política do
 * TENANT, não constante — o MVP tinha 24h fixas. Quem decide se o cliente pode
 * cancelar é `isWithinCancellationWindow` (F3.1); aqui só se aplica.
 *
 * LIBERAR O HORÁRIO É O PONTO. Marcar `status='CANCELLED'` tira a linha da
 * exclusion constraint `booking_no_overlap` (que só cobre HOLD/PENDING/
 * CONFIRMED), então a grade volta a ofertar o horário de verdade — não é um
 * `if` na aplicação. Um cancelamento que não devolve o slot seria pior que não
 * cancelar: o salão perderia a vaga e o cliente acharia que resolveu.
 *
 * EFEITO EXTERNO É PÓS-COMMIT. Os lembretes da F6.1 reagem a `BookingCancelled`.
 * O evento sai depois do commit e uma falha de handler não reabre o
 * agendamento — WhatsApp fora do ar não pode impedir um cancelamento.
 */

export type CancelBookingErrorCode =
  | 'INVALID_INPUT'
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'CANCELLATION_WINDOW_CLOSED';

export class CancelBookingError extends Error {
  readonly code: CancelBookingErrorCode;
  readonly status: number;

  constructor(code: CancelBookingErrorCode, message: string) {
    super(message);
    this.name = 'CancelBookingError';
    this.code = code;
    this.status = code === 'BOOKING_NOT_FOUND' ? 404 : code === 'INVALID_INPUT' ? 400 : 409;
  }
}

export interface CancelBookingInput {
  tenantId: string;
  bookingId: string;
  /**
   * `TenantMember.id` do cliente. Quando informado (portal), o cancelamento
   * exige POSSE do agendamento e respeita a janela do tenant. Ausente significa
   * ação de painel/staff (F3.5), que pode passar por cima da janela.
   */
  customerId?: string;
  /** `User.id` de quem cancelou; `null` quando foi o sistema. */
  cancelledBy?: string | null;
  reason?: string | null;
  /**
   * Ignora a janela do tenant. Só faz sentido em ação de painel — o portal
   * nunca liga isto.
   */
  bypassWindow?: boolean;
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
  /** Injetável para teste; padrão: handlers descobertos na pasta. */
  handlers?: BookingEventHandler<BookingCancelledEvent>[];
}

export interface CancelBookingResult {
  booking: Booking;
  /** `true` quando o agendamento já estava cancelado (clique duplo). */
  alreadyCancelled: boolean;
  cancelledAt: Date;
}

const CANCELLABLE_STATUSES = new Set(['HOLD', 'PENDING', 'CONFIRMED']);

/**
 * Cancela um agendamento do cliente, aplicando a janela do tenant.
 *
 * IDEMPOTENTE por contrato (mesma preocupação do clique duplo da F3.3): um
 * cliente com conexão ruim toca "Cancelar" duas vezes e a segunda resposta
 * precisa ser sucesso, não erro. Já cancelado e do mesmo cliente devolve o
 * registro existente sem emitir `BookingCancelled` de novo.
 */
export async function cancelBooking(input: CancelBookingInput): Promise<CancelBookingResult> {
  if (!input.tenantId) throw new CancelBookingError('INVALID_INPUT', 'tenantId é obrigatório.');
  if (!input.bookingId) throw new CancelBookingError('INVALID_INPUT', 'bookingId é obrigatório.');

  const now = input.now ?? new Date();

  const outcome = await forTenant(input.tenantId, async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: input.tenantId },
    });
    if (!booking) {
      throw new CancelBookingError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }

    // Posse: responder "não encontrado" (e não "sem permissão") evita confirmar
    // a existência de um agendamento de outro cliente.
    if (input.customerId && booking.customerId !== input.customerId) {
      throw new CancelBookingError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }

    if (booking.status === 'CANCELLED') {
      return { booking, alreadyCancelled: true };
    }
    if (!CANCELLABLE_STATUSES.has(booking.status)) {
      throw new CancelBookingError(
        'INVALID_STATE',
        `Um agendamento ${booking.status} não pode ser cancelado.`,
      );
    }

    if (input.customerId && !input.bypassWindow) {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { cancellationWindowHours: true },
      });
      if (
        !isWithinCancellationWindow({
          startsAt: booking.startsAt,
          cancellationWindowHours: tenant.cancellationWindowHours,
          now,
        })
      ) {
        throw new CancelBookingError(
          'CANCELLATION_WINDOW_CLOSED',
          'Este agendamento está fora do prazo de cancelamento definido pelo estabelecimento.',
        );
      }
    }

    const cancelled = await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: input.cancelledBy ?? null,
        cancellationReason: input.reason ?? null,
      },
    });

    return { booking: cancelled, alreadyCancelled: false };
  });

  const result: CancelBookingResult = {
    booking: outcome.booking,
    alreadyCancelled: outcome.alreadyCancelled,
    cancelledAt: now,
  };

  // Já estava cancelado: não reemite o evento — a F6.1 não deve avisar duas vezes.
  if (outcome.alreadyCancelled) return result;

  const event: BookingCancelledEvent = {
    type: 'BookingCancelled',
    tenantId: outcome.booking.tenantId,
    bookingId: outcome.booking.id,
    occurredAt: now,
    customerId: outcome.booking.customerId ?? '',
    staffId: outcome.booking.staffId,
    serviceId: outcome.booking.serviceId,
    startsAt: outcome.booking.startsAt,
    endsAt: outcome.booking.endsAt,
    cancelledBy: input.cancelledBy ?? null,
    reason: input.reason ?? null,
  };

  await emitBookingEvent(event, input.handlers);

  return result;
}

/**
 * Limite (UTC) em que o cancelamento do cliente deixa de ser permitido, para a
 * UI explicar a política. Não decide nada: quem decide é `cancelBooking`.
 */
export function cancellationDeadline(startsAt: Date, cancellationWindowHours: number): Date {
  return new Date(startsAt.getTime() - cancellationWindowHours * 3_600_000);
}
