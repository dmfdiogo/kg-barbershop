import type { BookingCancelledEvent, BookingConfirmationContext } from '@/lib/booking/confirm';
import { applyCreditForBooking, refundCreditForBooking } from '@/lib/membership/credits';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';

/**
 * Créditos do clube no ciclo do agendamento (tarefa F5.2), pelos DOIS contratos
 * do ponto de extensão da F3.2 (ver `lib/booking/participants/README.md`).
 *
 * 1. PARTICIPANTE DE TRANSAÇÃO (`participant`). O débito tem de ser ATÔMICO com
 *    a confirmação: se a confirmação vencer e o débito falhar, o cliente ganha
 *    um atendimento sem pagar; se o débito vencer e a confirmação abortar, o
 *    crédito some por um agendamento que não existe. Rodando dentro da
 *    transação, os dois vencem juntos ou nada acontece. É também o que torna o
 *    consumo seguro sob o retry do client escopado (P2034): o rollback leva o
 *    lançamento e o retry reaplica sem duplicar — o crédito vive no banco, não
 *    em memória.
 *
 *    O consumo é BEST-EFFORT de propósito. Um agendamento sem crédito segue o
 *    fluxo normal (checkout da F4 ou pagamento no balcão); um assinante com
 *    saldo zero não pode ter a confirmação derrubada só porque o clube acabou.
 *    A garantia de "nunca saldo negativo" mora na trava da `Membership` em
 *    `applyCreditForBooking`, não em recusar o agendamento.
 *
 * 2. HANDLER PÓS-COMMIT (`onBookingCancelled`). A devolução roda depois do
 *    commit porque o cancelamento já é um fato: uma falha ao devolver crédito
 *    não pode reabrir o agendamento cancelado. O handler abre a própria
 *    transação escopada e insere o estorno como lançamento NOVO;
 *    `refundCreditForBooking` é idempotente, então um cancelamento já
 *    processado não credita duas vezes. Segue a mesma decisão da remarcação
 *    (`lib/booking/reschedule.ts`): remarcar é o MESMO agendamento e não roda
 *    participantes, então o crédito continua consumido; só o cancelamento
 *    devolve.
 */
export async function participant(
  tx: TenantTransaction,
  context: BookingConfirmationContext,
): Promise<void> {
  await applyCreditForBooking(tx, {
    tenantId: context.tenantId,
    bookingId: context.bookingId,
    customerId: context.customerId,
    serviceId: context.serviceId,
  });
}

export async function onBookingCancelled(event: BookingCancelledEvent): Promise<void> {
  await forTenant(event.tenantId, (tx) =>
    refundCreditForBooking(tx, event.tenantId, event.bookingId),
  );
}
