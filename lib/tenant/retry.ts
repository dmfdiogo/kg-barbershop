/**
 * Retry com limite, usado pelo client escopado (lib/tenant/db.ts).
 *
 * O Prisma embrulha deadlock/serialization failure do Postgres (40P01/40001) em
 * P2034 — "Transaction failed due to a write conflict or a deadlock. Please
 * retry your transaction". Sob disputa de slot isso é esperado: o retry
 * reexecuta a transação e encontra o competidor já commitado, caindo na
 * exclusion constraint (23P01 -> SlotUnavailableError).
 *
 * O laço é limitado por `maxAttempts`: não existe retry infinito. Estourado o
 * limite, o último erro sobe como veio (e o client ainda o traduz).
 *
 * Contrato para quem usa: a operação pode ser executada mais de uma vez, então
 * precisa ser reexecutável e viver no banco (contexto-comum.md §4).
 */
export interface RetryOptions {
  /** Número total de tentativas, incluindo a primeira. Mínimo 1. */
  maxAttempts: number;
  /** Base do backoff linear entre tentativas, em ms. Padrão: 25. */
  baseDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (options.maxAttempts < 1) {
    throw new Error('runWithRetry exige maxAttempts >= 1');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt >= options.maxAttempts;
      if (isLastAttempt || !options.isRetryable(error)) break;
      await delay((options.baseDelayMs ?? 25) * attempt);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
