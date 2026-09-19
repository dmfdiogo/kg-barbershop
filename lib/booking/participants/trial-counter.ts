import type { TenantTransaction } from '@/lib/tenant/db';
import type { BookingConfirmationContext } from '@/lib/booking/confirm';
import { countTrialBooking } from '@/lib/billing/trial';

/**
 * Contador da trial por valor (tarefa F7.1) — participante de transação da
 * confirmação (contrato da F3.2, ver `lib/booking/participants/README.md`).
 *
 * Por que participante e não handler pós-commit: o incremento precisa ser
 * ATÔMICO com a confirmação. Se a confirmação vencer e o incremento falhar, o
 * agendamento fica fora da conta; se o incremento vencer e a confirmação
 * abortar, o tenant perde trial por um agendamento que não existe. Rodando
 * dentro da transação, os dois vencem juntos ou nada acontece.
 *
 * Por que a exclusão de remarcação é automática: a remarcação da F3.4 chama
 * `confirmBookingInTransaction` com `participants: []` de propósito — remarcar
 * é o mesmo agendamento em outro horário e não pode contar de novo. Este
 * participante só é descoberto por `confirmBooking`, o caminho de confirmação
 * de verdade.
 *
 * REENTRÂNCIA: `countTrialBooking` é um incremento atômico no banco; o retry do
 * client escopado desfaz a tentativa inteira e reaplica, sem contar dobrado.
 */
export async function participant(
  tx: TenantTransaction,
  context: BookingConfirmationContext,
): Promise<void> {
  await countTrialBooking(tx, context.tenantId);
}
