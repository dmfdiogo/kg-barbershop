import { getAsaasPaymentProvider } from './asaas';
import { getMockPaymentProvider } from './mock';
import type { PaymentProvider } from './types';

export * from './types';

/**
 * Factory do port de pagamentos (`fases/contexto-comum.md` §5).
 * Nenhum código de produto importa `mock.ts`/`asaas.ts` diretamente — só esta
 * factory. Trocar a implementação é variável de ambiente, nada mais.
 */
export function getPaymentProvider(): PaymentProvider {
  const provider = process.env.PAYMENT_PROVIDER ?? 'mock';

  switch (provider) {
    case 'mock':
      return getMockPaymentProvider();
    case 'asaas':
      return getAsaasPaymentProvider();
    default:
      throw new Error(
        `PAYMENT_PROVIDER inválido: ${JSON.stringify(provider)}. Use "mock" ou "asaas".`,
      );
  }
}

export { MockPaymentProvider, getMockPaymentProvider, resetMockPaymentProvider } from './mock';
export type { MockPaymentProviderOptions, MockSimulationResult } from './mock';
export {
  getMockPaymentStore,
  resetMockPaymentStore,
  snapshotMockPaymentStore,
  type MockPaymentStore,
  type MockPaymentStoreSnapshot,
} from './mock-store';
