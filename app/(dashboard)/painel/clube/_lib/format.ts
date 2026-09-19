import type { MembershipBenefitView } from '@/lib/membership/plans';

/**
 * Resumo dos benefícios de um plano para a tela (tarefa F5.0).
 *
 * Puro e sem cor: o mesmo texto aparece na home do clube (server) e na lista de
 * planos (client), então mora num só lugar.
 */
export function formatPlanBenefits(benefits: readonly MembershipBenefitView[]): string {
  if (benefits.length === 0) return 'Sem benefícios';
  return benefits
    .map((benefit) => `${benefit.quantityPerCycle}× ${benefit.serviceName}`)
    .join(' · ');
}
