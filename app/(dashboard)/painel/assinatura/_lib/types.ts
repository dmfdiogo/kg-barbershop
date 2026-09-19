import type { PlanChangeAssessment } from '@/lib/billing/limits';
import type { BillingPlanCode } from '@/lib/billing/plans';

/**
 * Contratos das server actions da assinatura (tarefa F8.0-B).
 *
 * Ficam FORA de `actions.ts` de propósito: um módulo `'use server'` só deve
 * exportar funções assíncronas, e os componentes de cliente precisam destes
 * tipos. Assim o arquivo de actions é casca fina e serializável.
 */

/**
 * Códigos estáveis para a UI. Os quatro do meio espelham os códigos de
 * `lib/billing/subscription.ts` (`NO_SUBSCRIPTION`, `SAME_PLAN`,
 * `DOWNGRADE_REQUIRES_DECISION`, `INVALID_DEACTIVATION`, `PROVIDER_ERROR`) e os
 * demais são decisões desta tela.
 */
export type SubscriptionActionErrorCode =
  | 'FORBIDDEN'
  | 'INVALID_PLAN'
  | 'NO_ORIGIN'
  | 'ALREADY_SUBSCRIBED'
  | 'NO_SUBSCRIPTION'
  | 'SAME_PLAN'
  | 'DOWNGRADE_REQUIRES_DECISION'
  | 'INVALID_DEACTIVATION'
  | 'PROVIDER_ERROR'
  | 'UNAVAILABLE';

export interface SubscriptionActionFailure {
  ok: false;
  code: SubscriptionActionErrorCode;
  message: string;
  /**
   * Avaliação do downgrade, quando o erro a tem. Permite à tela reabrir a
   * decisão (quem desativar) sem uma segunda ida ao servidor.
   */
  assessment?: PlanChangeAssessment;
}

export type SubscriptionActionResult<T> = ({ ok: true } & T) | SubscriptionActionFailure;

export interface StartCheckoutSuccess {
  /** URL absoluta e hospedada do provedor. A tela só redireciona para lá. */
  url: string;
}

export interface OpenPortalSuccess {
  url: string;
}

export interface ChangePlanSuccess {
  plan: BillingPlanCode;
  deactivatedStaffIds: string[];
}

export interface CancelSubscriptionSuccess {
  cancelAtPeriodEnd: boolean;
  /** ISO 8601 do fim do período, quando o provedor informa. */
  currentPeriodEnd: string | null;
}
