import {
  getAgendaUsage,
  type AgendaUsage,
} from '@/lib/billing/limits';
import {
  getLocalSubscriptionInTransaction,
  type LocalSubscription,
} from '@/lib/billing/subscription';
import { getTrialStatus, type TrialStatus } from '@/lib/billing/trial';
import type { TenantTransaction } from '@/lib/tenant/db';

/**
 * Leitura do estado de cobrança para a tela de assinatura (tarefa F8.0-B).
 *
 * Nenhuma regra mora aqui: preço e limite vêm de `lib/billing/plans.ts`, o
 * estado da trial de `lib/billing/trial.ts` e a assinatura de
 * `lib/billing/subscription.ts`. Este módulo só junta as três leituras na
 * ordem que o adapter-pg do Prisma aceita (sequencial — nota em
 * `lib/tenant/db.ts`) e reduz o estado a uma fase estável para a UI.
 */

/**
 * Fase exibida pela tela.
 *
 *   - `TRIAL`     — sem `PlatformSub`: a trial por valor de 10 agendamentos.
 *   - `AWAITING`  — `PlatformSub` criado no início do checkout e ainda SEM
 *                   assinatura do provedor (`stripeSubscriptionId` nulo). É o
 *                   estado da volta da página hospedada antes do webhook: a
 *                   tela diz "aguardando confirmação", NUNCA "ativo".
 *   - `TRIALING`  — assinatura confirmada em período de teste de cobrança.
 *   - `ACTIVE`    — assinatura em dia.
 *   - `PAST_DUE`  — mensalidade em atraso; suspensão graciosa.
 *   - `CANCELED`  — assinatura encerrada.
 */
export type SubscriptionPhase =
  | 'TRIAL'
  | 'AWAITING'
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED';

export interface BillingOverview {
  phase: SubscriptionPhase;
  /** `null` na trial pura (sem `PlatformSub`). */
  subscription: LocalSubscription | null;
  trial: TrialStatus;
  usage: AgendaUsage;
  /**
   * `true` quando existe assinatura no provedor e o dono pode trocar de plano
   * e cancelar. Não vale para `AWAITING` (assinatura ainda não nasceu) nem para
   * `CANCELED` (encerrada; o domínio não troca plano de assinatura cancelada).
   */
  canManage: boolean;
}

export function deriveSubscriptionPhase(
  subscription: LocalSubscription | null,
): SubscriptionPhase {
  if (!subscription) return 'TRIAL';
  // Sem id do provedor a assinatura ainda não existe do outro lado: o que há é
  // a intenção gravada antes do redirecionamento ao Checkout.
  if (!subscription.stripeSubscriptionId) return 'AWAITING';
  switch (subscription.status) {
    case 'TRIALING':
      return 'TRIALING';
    case 'ACTIVE':
      return 'ACTIVE';
    case 'PAST_DUE':
      return 'PAST_DUE';
    case 'CANCELED':
      return 'CANCELED';
  }
}

export function canManageSubscription(phase: SubscriptionPhase): boolean {
  return phase === 'TRIALING' || phase === 'ACTIVE' || phase === 'PAST_DUE';
}

export async function loadBillingOverview(
  tx: TenantTransaction,
  tenantId: string,
): Promise<BillingOverview> {
  const subscription = await getLocalSubscriptionInTransaction(tx, tenantId);
  const trial = await getTrialStatus(tx, tenantId);
  const usage = await getAgendaUsage(tx, tenantId);
  const phase = deriveSubscriptionPhase(subscription);

  return {
    phase,
    subscription,
    trial,
    usage,
    canManage: canManageSubscription(phase),
  };
}
