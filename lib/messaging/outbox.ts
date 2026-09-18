import { randomUUID } from 'node:crypto';
import type { TemplateName } from './templates';

export interface OutboxMessage {
  id: string;
  providerMessageId: string;
  to: string;
  kind: 'otp' | 'template';
  template: TemplateName;
  /** Presente apenas em mensagens de OTP — é o que o login lê em /dev/outbox. */
  code?: string;
  vars: Record<string, string>;
  sentAt: string;
}

const MAX_MESSAGES = 200;
const GLOBAL_KEY = '__kg_messaging_outbox__';

interface OutboxStore {
  messages: OutboxMessage[];
}

/**
 * O console /dev e o mock precisam compartilhar estado. Cada entrypoint do Next
 * (página, rota, server action) tem o próprio grafo de módulos, então um
 * `let messages = []` de módulo seria duplicado; o globalThis é o único ponto
 * realmente compartilhado dentro do processo do servidor.
 */
function getStore(): OutboxStore {
  const globalStore = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: OutboxStore;
  };
  globalStore[GLOBAL_KEY] ??= { messages: [] };
  return globalStore[GLOBAL_KEY];
}

export function recordOutboxMessage(
  message: Omit<OutboxMessage, 'id' | 'sentAt'> & { sentAt?: string },
): OutboxMessage {
  const stored: OutboxMessage = {
    ...message,
    id: randomUUID(),
    sentAt: message.sentAt ?? new Date().toISOString(),
  };
  const store = getStore();
  store.messages.unshift(stored);
  if (store.messages.length > MAX_MESSAGES) {
    store.messages.length = MAX_MESSAGES;
  }
  return stored;
}

/** Mais recentes primeiro. */
export function listOutboxMessages(): readonly OutboxMessage[] {
  return getStore().messages;
}

export function clearOutboxMessages(): void {
  getStore().messages = [];
}
