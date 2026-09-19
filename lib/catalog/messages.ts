import type { ServiceDeletionResult } from './types';

/**
 * Mensagens de recusa de exclusão (tarefa F2.1). Módulo seguro para o cliente:
 * a tela de serviços precisa explicar POR QUE não pode excluir e oferecer
 * desativar. Manter aqui evita que o componente de cliente importe o módulo de
 * domínio (que carrega tipos do Prisma).
 */
export function deletionRefusalMessage(
  result: Extract<ServiceDeletionResult, { ok: false }>,
): string {
  switch (result.code) {
    case 'HAS_FUTURE_BOOKINGS':
      return result.futureBookings === 1
        ? 'Este serviço tem 1 agendamento futuro. Para tirá-lo do catálogo sem apagar o histórico de quem reservou, desative-o.'
        : `Este serviço tem ${result.futureBookings} agendamentos futuros. Para tirá-lo do catálogo sem apagar o histórico de quem reservou, desative-o.`;
    case 'HAS_HISTORY':
      return 'Este serviço já tem histórico de agendamentos e não pode ser excluído. Desative-o para tirá-lo do catálogo.';
    case 'NOT_FOUND':
      return 'Serviço não encontrado.';
  }
}
