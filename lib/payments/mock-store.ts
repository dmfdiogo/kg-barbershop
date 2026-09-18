import type {
  Charge,
  ChargeStatus,
  KycStatus,
  MerchantAccount,
  Refund,
  Subscription,
} from './types';

export interface AppChargeState {
  chargeId: string;
  status: ChargeStatus;
  paidAt?: string;
  refundedCents: number;
  lastEventType: string;
  updatedAt: string;
}

export interface AppMerchantState {
  accountId: string;
  kycStatus: KycStatus;
  updatedAt: string;
}

export interface CardTokenRecord {
  token: string;
  accountId: string;
  customerId: string;
  last4: string;
  createdAt: string;
}

export interface WebhookDeliveryLogEntry {
  id: string;
  eventId: string;
  type: string;
  url: string;
  delivered: boolean;
  httpStatus?: number;
  error?: string;
  at: string;
}

const MAX_DELIVERIES = 100;

/**
 * Estado do mock, deliberadamente em memória.
 *
 * A F0.3 roda em paralelo com a F0.2 (schema/Prisma) e não pode tocar no banco.
 * A "projeção do app" (`appMerchants`/`appCharges`) faz o papel do registro
 * local que a F4.0 persistirá e só muda por webhook — é o que prova que o mock
 * não marca pagamento de forma síncrona.
 *
 * LIMITAÇÃO CONHECIDA: o estado vive no `globalThis` de UM processo. Funciona
 * em `next dev`/`next start` e na suíte de testes, mas se a aplicação passar a
 * rodar em múltiplos processos/workers, cada um terá o seu store e o console
 * `/dev` mostrará apenas o que aquele processo atendeu. `/dev` é ferramenta de
 * desenvolvimento e não existe em produção; se isso mudar, troque por um store
 * compartilhado (arquivo ou banco) — não por estado global espalhado.
 */
export interface MockPaymentStore {
  sequence: number;
  /** Verdade do provedor (o que o "Asaas" sabe). */
  merchants: Map<string, MerchantAccount>;
  charges: Map<string, Charge>;
  refunds: Map<string, Refund>;
  subscriptions: Map<string, Subscription>;
  cardTokens: Map<string, CardTokenRecord>;
  /** Estado do lado da aplicação (só muda por webhook). */
  appMerchants: Map<string, AppMerchantState>;
  appCharges: Map<string, AppChargeState>;
  appliedWebhookEvents: Map<string, string>;
  webhookDeliveries: WebhookDeliveryLogEntry[];
}

const GLOBAL_KEY = '__kg_payments_mock_store__';

export function createMockPaymentStore(): MockPaymentStore {
  return {
    sequence: 0,
    merchants: new Map(),
    charges: new Map(),
    refunds: new Map(),
    subscriptions: new Map(),
    cardTokens: new Map(),
    appMerchants: new Map(),
    appCharges: new Map(),
    appliedWebhookEvents: new Map(),
    webhookDeliveries: [],
  };
}

export function nextMockId(store: MockPaymentStore, prefix: string): string {
  store.sequence += 1;
  return `${prefix}_${store.sequence}`;
}

export function getMockPaymentStore(): MockPaymentStore {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: MockPaymentStore;
  };
  globalStore[GLOBAL_KEY] ??= createMockPaymentStore();
  return globalStore[GLOBAL_KEY];
}

export function resetMockPaymentStore(): void {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: MockPaymentStore;
  };
  globalStore[GLOBAL_KEY] = createMockPaymentStore();
}

export function appendWebhookDelivery(
  store: MockPaymentStore,
  entry: WebhookDeliveryLogEntry,
): void {
  store.webhookDeliveries.unshift(entry);
  if (store.webhookDeliveries.length > MAX_DELIVERIES) {
    store.webhookDeliveries.length = MAX_DELIVERIES;
  }
}

/** Cópia defensiva: o store nunca deve escapar por referência para o chamador. */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface MockPaymentStoreSnapshot {
  merchants: MerchantAccount[];
  charges: Charge[];
  refunds: Refund[];
  subscriptions: Subscription[];
  appMerchants: AppMerchantState[];
  appCharges: AppChargeState[];
  webhookDeliveries: WebhookDeliveryLogEntry[];
  appliedWebhookEventCount: number;
}

export function snapshotMockPaymentStore(
  store: MockPaymentStore = getMockPaymentStore(),
): MockPaymentStoreSnapshot {
  return {
    merchants: [...store.merchants.values()].map(copy),
    charges: [...store.charges.values()].map(copy),
    refunds: [...store.refunds.values()].map(copy),
    subscriptions: [...store.subscriptions.values()].map(copy),
    appMerchants: [...store.appMerchants.values()].map(copy),
    appCharges: [...store.appCharges.values()].map(copy),
    webhookDeliveries: store.webhookDeliveries.map(copy),
    appliedWebhookEventCount: store.appliedWebhookEvents.size,
  };
}
