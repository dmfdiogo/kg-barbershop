import type {
  BookingCancelledEvent,
  BookingConfirmedEvent,
  BookingRescheduledEvent,
} from '@/lib/booking/confirm';
import {
  scheduleBookingCancelledNotifications,
  scheduleBookingConfirmedNotifications,
  scheduleBookingRescheduledNotifications,
} from '@/lib/messaging/triggers';

/**
 * Gatilhos de notificação (tarefa F6.1) pelo ponto de extensão PÓS-COMMIT da
 * F3.2 (`lib/booking/participants/README.md`, contrato 2).
 *
 * Por que pós-commit e não participante de transação: WhatsApp fora do ar não
 * pode impedir alguém de marcar horário. Um participante que lança aborta a
 * confirmação inteira; um handler pós-commit tem a falha isolada e registrada.
 * Além disso o WhatsApp é chamada externa, e nada externo pode viver dentro de
 * uma transação que o client escopado reexecuta em caso de `P2034`.
 *
 * Cada handler só TRADUZ evento em `NotificationJob` (F6.0). O envio é do cron
 * `/api/cron/send-notifications`; aqui não há mensagem saindo.
 */

export async function onBookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
  await scheduleBookingConfirmedNotifications({
    tenantId: event.tenantId,
    bookingId: event.bookingId,
    now: event.occurredAt,
  });
}

export async function onBookingCancelled(event: BookingCancelledEvent): Promise<void> {
  await scheduleBookingCancelledNotifications({
    tenantId: event.tenantId,
    bookingId: event.bookingId,
    now: event.occurredAt,
  });
}

export async function onBookingRescheduled(event: BookingRescheduledEvent): Promise<void> {
  await scheduleBookingRescheduledNotifications({
    tenantId: event.tenantId,
    bookingId: event.bookingId,
    now: event.occurredAt,
  });
}
