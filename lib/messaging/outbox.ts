import { appendFileSync } from 'node:fs';
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

/**
 * Espelho em arquivo, para testes end-to-end.
 *
 * O `/dev/outbox` responde 404 fora de desenvolvimento, e o Playwright sobe o
 * servidor com `next start` — em produção, de propósito, porque foi assim que
 * pegamos a falta de `APP_DOMAIN`. As duas coisas se anulavam: o e2e do login
 * precisa do código do OTP e não tinha por onde lê-lo.
 *
 * A saída não é afrouxar o guard da rota, e sim dar ao mock um canal próprio:
 * quando `MESSAGING_OUTBOX_FILE` aponta para um caminho, cada mensagem é
 * anexada lá como JSON por linha. Isso não enfraquece nada em produção de
 * verdade, porque o mock só existe quando `MESSAGING_PROVIDER=mock` — e em
 * produção o provider é o real.
 */
function mirrorToFile(message: OutboxMessage): void {
  const target = process.env.MESSAGING_OUTBOX_FILE;
  if (!target) return;
  try {
    appendFileSync(target, `${JSON.stringify(message)}\n`, 'utf8');
  } catch {
    // Espelho é conveniência de teste: falhar aqui não pode derrubar um envio.
  }
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
  mirrorToFile(stored);
  return stored;
}

/** Mais recentes primeiro. */
export function listOutboxMessages(): readonly OutboxMessage[] {
  return getStore().messages;
}

export function clearOutboxMessages(): void {
  getStore().messages = [];
}
