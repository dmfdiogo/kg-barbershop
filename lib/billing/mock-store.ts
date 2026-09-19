import type { BillingCustomer, BillingSubscription } from './types';

/**
 * Sessão hospedada pendente. É o que o Stripe chama de Checkout Session: existe
 * antes de haver assinatura, e some quando o pagamento conclui ou a URL vence.
 * Guardar o plano aqui é o que permite criar a assinatura certa na conclusão,
 * sem confiar em nada que volte pela URL de retorno.
 */
export interface BillingCheckoutSessionRecord {
  id: string;
  customerId: string;
  plan: string;
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED';
  trialEndsAt?: string;
  externalReference?: string;
  successUrl: string;
  cancelUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface BillingWebhookDeliveryLogEntry {
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
 * Estado do mock de billing, em memória — a mesma decisão do mock de pagamentos
 * (`contexto-comum.md` §5.3): dado falso de provedor não mora no schema de
 * domínio, que é a fonte de verdade do que realmente aconteceu. Quem persiste
 * `PlatformSub`/`WebhookEvent` é o código de produto ao processar o webhook.
 *
 * LIMITAÇÃO CONHECIDA: vive no `globalThis` de UM processo. Serve ao `next
 * dev`/`next start` e à suíte; se a aplicação passar a rodar em múltiplos
 * workers, cada um teria o seu store.
 */
export interface MockBillingStore {
  sequence: number;
  /** Verdade do provedor. */
  customers: Map<string, BillingCustomer>;
  subscriptions: Map<string, BillingSubscription>;
  checkoutSessions: Map<string, BillingCheckoutSessionRecord>;
  appliedWebhookEvents: Map<string, string>;
  webhookDeliveries: BillingWebhookDeliveryLogEntry[];
}

const GLOBAL_KEY = '__kg_billing_mock_store__';

export function createMockBillingStore(): MockBillingStore {
  return {
    sequence: 0,
    customers: new Map(),
    subscriptions: new Map(),
    checkoutSessions: new Map(),
    appliedWebhookEvents: new Map(),
    webhookDeliveries: [],
  };
}

export function nextMockBillingId(store: MockBillingStore, prefix: string): string {
  store.sequence += 1;
  return `${prefix}_${store.sequence}`;
}

export function getMockBillingStore(): MockBillingStore {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: MockBillingStore;
  };
  globalStore[GLOBAL_KEY] ??= createMockBillingStore();
  return globalStore[GLOBAL_KEY];
}

export function resetMockBillingStore(): void {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: MockBillingStore;
  };
  globalStore[GLOBAL_KEY] = createMockBillingStore();
}

export function appendBillingWebhookDelivery(
  store: MockBillingStore,
  entry: BillingWebhookDeliveryLogEntry,
): void {
  store.webhookDeliveries.unshift(entry);
  if (store.webhookDeliveries.length > MAX_DELIVERIES) {
    store.webhookDeliveries.length = MAX_DELIVERIES;
  }
}

/** Cópia defensiva: o store nunca escapa por referência para o chamador. */
export function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
