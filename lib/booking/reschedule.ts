import type { Booking } from '@prisma/client';
import { forTenant } from '@/lib/tenant/db';
import { isWithinCancellationWindow } from './availability';
import {
  confirmBookingInTransaction,
  emitBookingEvent,
  type BookingParticipant,
  type BookingRescheduledEvent,
  type BookingEventHandler,
} from './confirm';
import { createHoldInTransaction } from './hold';

/**
 * Remarcação do agendamento (tarefa F3.4).
 *
 * "Liberar o antigo e reservar o novo" precisa ser ATÔMICO: se o horário novo
 * não couber, o antigo tem de continuar de pé; se couber, o antigo não pode
 * ficar preso. A única forma honesta de garantir isso é uma transação só, e é
 * por isso que este módulo reusa `createHoldInTransaction` e
 * `confirmBookingInTransaction` — os núcleos da F3.2 — em vez de reimplementar
 * hold e confirmação aqui.
 *
 * ORDEM DENTRO DA TRANSAÇÃO: primeiro cancela o antigo, depois cria e confirma o
 * novo. Cancelar primeiro derruba a linha antiga da exclusion constraint, então
 * até um horário que sobrepõe levemente o anterior é aceito (o cliente que
 * empurra 15 minutos não é barrado pela própria reserva). Se a inserção do novo
 * colidir com a reserva de OUTRA pessoa, o erro 23P01 aborta a transação e o
 * rollback devolve o agendamento antigo — nada se perde.
 *
 * COMOEMITIR: o evento é `BookingRescheduled`, não `BookingConfirmed`. A F6.1
 * usa os dois lados (antigo e novo) para avisar cliente e profissional; emitir
 * um `BookingConfirmed` extra duplicaria o aviso de "agendamento confirmado".
 */

export type RescheduleBookingErrorCode =
  | 'INVALID_INPUT'
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'CANCELLATION_WINDOW_CLOSED';

export class RescheduleBookingError extends Error {
  readonly code: RescheduleBookingErrorCode;
  readonly status: number;

  constructor(code: RescheduleBookingErrorCode, message: string) {
    super(message);
    this.name = 'RescheduleBookingError';
    this.code = code;
    this.status = code === 'BOOKING_NOT_FOUND' ? 404 : code === 'INVALID_INPUT' ? 400 : 409;
  }
}

export interface RescheduleBookingInput {
  tenantId: string;
  bookingId: string;
  /** `TenantMember.id` dono do agendamento. Obrigatório: só o dono remarca. */
  customerId: string;
  /** Instante UTC do novo horário, vindo da grade. */
  newStartsAt: Date;
  /** Dono do hold novo (sessão/dispositivo); obrigatório e não vazio. */
  holdSessionId: string;
  /** `User.id` de quem remarcou, gravado no cancelamento do antigo. */
  cancelledBy?: string | null;
  reason?: string | null;
  /** Ação de painel pode ignorar a janela; o portal nunca liga isto. */
  bypassWindow?: boolean;
  now?: Date;
  /** Injetável para teste; padrão: participantes descobertos na pasta. */
  participants?: BookingParticipant[];
  /** Injetável para teste; padrão: handlers descobertos na pasta. */
  handlers?: BookingEventHandler<BookingRescheduledEvent>[];
}

export interface RescheduleBookingResult {
  /** O agendamento antigo, agora `CANCELLED`. */
  previous: Booking;
  /** O agendamento novo, `CONFIRMED`. */
  booking: Booking;
}

const RESCHEDULABLE_STATUSES = new Set(['CONFIRMED', 'PENDING']);

export async function rescheduleBooking(
  input: RescheduleBookingInput,
): Promise<RescheduleBookingResult> {
  if (!input.tenantId) throw new RescheduleBookingError('INVALID_INPUT', 'tenantId é obrigatório.');
  if (!input.bookingId) throw new RescheduleBookingError('INVALID_INPUT', 'bookingId é obrigatório.');
  if (!input.customerId) throw new RescheduleBookingError('INVALID_INPUT', 'customerId é obrigatório.');
  if (!input.holdSessionId || input.holdSessionId.trim() === '') {
    throw new RescheduleBookingError('INVALID_INPUT', 'holdSessionId é obrigatório.');
  }
  if (!(input.newStartsAt instanceof Date) || Number.isNaN(input.newStartsAt.getTime())) {
    throw new RescheduleBookingError('INVALID_INPUT', 'newStartsAt deve ser uma data válida.');
  }

  const now = input.now ?? new Date();

  /**
   * Remarcação NÃO roda os participantes da confirmação, e isso é decisão de
   * domínio, não economia.
   *
   * Participante existe para "este agendamento passou a valer": débito de
   * crédito do clube (F5.2), contador de trial (F7.1). Remarcar é o MESMO
   * agendamento em outro horário — o crédito já foi consumido e o trial já foi
   * contado. Reexecutar cobraria duas vezes pela mesma visita.
   *
   * Quem precisa reagir à remarcação usa o evento pós-commit
   * `BookingRescheduled`, que é emitido normalmente (a F6.1 avisa cliente e
   * profissional por ele). Se alguma fase futura precisar de trabalho DENTRO da
   * transação de remarcação, isso é decisão nova e deve ser pedida.
   */
  const participants = input.participants ?? [];

  const outcome = await forTenant(input.tenantId, async (tx) => {
    const previous = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: input.tenantId },
    });
    if (!previous) {
      throw new RescheduleBookingError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }
    if (previous.customerId !== input.customerId) {
      throw new RescheduleBookingError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }
    if (!RESCHEDULABLE_STATUSES.has(previous.status)) {
      throw new RescheduleBookingError(
        'INVALID_STATE',
        `Um agendamento ${previous.status} não pode ser remarcado.`,
      );
    }
    if (previous.startsAt.getTime() === input.newStartsAt.getTime()) {
      throw new RescheduleBookingError('INVALID_INPUT', 'Escolha um horário diferente do atual.');
    }

    if (!input.bypassWindow) {
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: input.tenantId },
        select: { cancellationWindowHours: true },
      });
      if (
        !isWithinCancellationWindow({
          startsAt: previous.startsAt,
          cancellationWindowHours: tenant.cancellationWindowHours,
          now,
        })
      ) {
        throw new RescheduleBookingError(
          'CANCELLATION_WINDOW_CLOSED',
          'Este agendamento está fora do prazo de remarcação definido pelo estabelecimento.',
        );
      }
    }

    // 1. Libera o antigo NA MESMA transação. Ainda não é visível para outros;
    //    se algo abaixo falhar, o rollback o traz de volta.
    const released = await tx.booking.update({
      where: { id: previous.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: input.cancelledBy ?? null,
        cancellationReason: input.reason ?? 'Rescheduled',
      },
    });

    // 2. Novo hold, mesmo serviço e profissional (remarcar não troca de barbeiro).
    const hold = await createHoldInTransaction(tx, {
      tenantId: input.tenantId,
      customerId: input.customerId,
      staffId: previous.staffId,
      serviceId: previous.serviceId,
      startsAt: input.newStartsAt,
      holdSessionId: input.holdSessionId,
      source: previous.source,
      now,
    });

    // 3. Confirma o novo reusando o núcleo da confirmação (participantes
    //    atômicos inclusos). A exclusivity do hold impede corrida com terceiros.
    const confirmed = await confirmBookingInTransaction(tx, {
      tenantId: input.tenantId,
      bookingId: hold.id,
      customerId: input.customerId,
      now,
      participants,
    });

    return { previous: released, booking: confirmed.booking };
  });

  const event: BookingRescheduledEvent = {
    type: 'BookingRescheduled',
    tenantId: outcome.booking.tenantId,
    bookingId: outcome.booking.id,
    occurredAt: now,
    customerId: input.customerId,
    serviceId: outcome.booking.serviceId,
    previousStaffId: outcome.previous.staffId,
    previousStartsAt: outcome.previous.startsAt,
    previousEndsAt: outcome.previous.endsAt,
    staffId: outcome.booking.staffId,
    startsAt: outcome.booking.startsAt,
    endsAt: outcome.booking.endsAt,
  };

  await emitBookingEvent(event, input.handlers);

  return { previous: outcome.previous, booking: outcome.booking };
}
