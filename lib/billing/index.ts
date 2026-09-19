import { getMockBillingProvider } from './mock';
import type { BillingProvider } from './types';

export * from './types';

/**
 * Factory do port de billing (`fases/contexto-comum.md` §5).
 * Nenhum código de produto importa `mock.ts`/`stripe.ts` diretamente — só esta
 * factory. Trocar a implementação é variável de ambiente, nada mais.
 */
export function getBillingProvider(): BillingProvider {
  const provider = process.env.BILLING_PROVIDER ?? 'mock';

  switch (provider) {
    case 'mock':
      return getMockBillingProvider();
    case 'stripe':
      // O adaptador real é a tarefa F8.1. Enquanto ele não existe, falhar cedo
      // é melhor do que devolver um provider que não cobra ninguém.
      throw new Error(
        'BILLING_PROVIDER=stripe: adaptador real ainda não implementado (tarefa F8.1).',
      );
    default:
      throw new Error(
        `BILLING_PROVIDER inválido: ${JSON.stringify(provider)}. Use "mock" ou "stripe".`,
      );
  }
}

export { MockBillingProvider, getMockBillingProvider, resetMockBillingProvider } from './mock';
export type { MockBillingProviderOptions, MockBillingSimulationResult } from './mock';
export {
  getMockBillingStore,
  resetMockBillingStore,
  createMockBillingStore,
  type MockBillingStore,
} from './mock-store';
export {
  BILLING_PLANS,
  BILLING_PLAN_CODES,
  getBillingPlan,
  isBillingPlanCode,
  nextUpgrade,
  planDirection,
  planRank,
  upgradeOptions,
  type BillingPlanCode,
  type BillingPlanDefinition,
  type PlanDirection,
} from './plans';
export {
  assertCanAddAgenda,
  assessPlanChange,
  changePlan,
  formatBRL,
  getAgendaUsage,
  listActiveAgendas,
  type ActiveAgenda,
  type AddAgendaDecision,
  type AgendaUpgrade,
  type AgendaUsage,
  type ChangePlanOptions,
  type PlanChangeAssessment,
  type PlanChangeResult,
} from './limits';
