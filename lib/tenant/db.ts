import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { translatePostgresError } from './errors';
import { runWithRetry } from './retry';

/**
 * Client Prisma escopado por tenant — a camada de aplicação do isolamento
 * (contexto-comum.md §4). Nunca importe `PrismaClient` cru em código de
 * produto: o único caminho de acesso é `forTenant()` ou, para o Super Admin,
 * `asPlatformAdmin()`.
 *
 * Como funciona: cada operação abre uma transação interativa e executa
 * `set_config('app.current_tenant', $1, true)` (equivalente a `SET LOCAL`)
 * antes da callback. O `true` é essencial — sem ele o GUC seria de sessão e
 * vazaria entre requisições no pool. Fora de transação, `SET LOCAL` não tem
 * efeito (o Postgres só emite um warning): por isso a API não expõe nenhuma
 * forma de usar o client fora da callback transacional.
 *
 * A segunda camada é a RLS no banco (migration 20260918142000): as policies
 * comparam `current_setting('app.current_tenant')` e falham fechado quando o
 * GUC não está setado. `asPlatformAdmin()` seta `app.is_platform_admin`, o
 * único bypass — explícito e restrito ao caminho do Super Admin.
 *
 * A violação da exclusion constraint de agenda (23P01) é traduzida para
 * `SlotUnavailableError` antes de sair da transação.
 *
 * Callbacks podem ser reexecutadas: uma transação abortada por deadlock/
 * serialização (P2034, comum quando duas reservas disputam o mesmo slot) é
 * tentada de novo antes de propagar o erro. Nada fora do banco deve acontecer
 * dentro da callback.
 */

export type TenantTransaction = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Timeout da transação interativa, em ms. Padrão: 15000. */
  timeoutMs?: number;
  /** Tempo máximo esperando uma conexão livre, em ms. Padrão: 5000. */
  maxWaitMs?: number;
}

export interface TenantDb {
  /** Executa a callback como o tenant informado. */
  forTenant<T>(
    tenantId: string,
    fn: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  /** Executa a callback como Super Admin, ignorando a RLS de propósito. */
  asPlatformAdmin<T>(
    fn: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
  /** Fecha o pool. Usado no teardown de testes. */
  disconnect(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 5_000;

// P2034 = "Transaction failed due to a write conflict or a deadlock. Please
// retry your transaction". Duas inserções concorrentes que disputam a
// exclusion constraint podem terminar em deadlock (40P01) em vez de 23P01 — o
// retry reexecuta e encontra o competidor já commitado, virando
// SlotUnavailableError. Depois das tentativas, o erro sobe como veio.
const RETRYABLE_TRANSACTION_CODE = 'P2034';
const MAX_TRANSACTION_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 25;

async function setCurrentTenant(tx: TenantTransaction, tenantId: string): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
}

async function markPlatformAdmin(tx: TenantTransaction): Promise<void> {
  await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === RETRYABLE_TRANSACTION_CODE
  );
}

/**
 * Cria um client escopado isolado (útil em testes, que apontam para uma role
 * NÃO-superuser para que a RLS realmente valha).
 */
export function createTenantDb(connectionString: string): TenantDb {
  if (!connectionString) {
    throw new Error('createTenantDb exige uma connection string');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  async function run<T>(
    setContext: (tx: TenantTransaction) => Promise<void>,
    fn: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    try {
      return await runWithRetry(
        () =>
          prisma.$transaction(
            async (tx) => {
              await setContext(tx);
              return fn(tx);
            },
            {
              timeout: options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
              maxWait: options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
            },
          ),
        {
          maxAttempts: MAX_TRANSACTION_ATTEMPTS,
          baseDelayMs: RETRY_BASE_DELAY_MS,
          isRetryable: isRetryableTransactionError,
        },
      );
    } catch (error) {
      throw translatePostgresError(error);
    }
  }

  return {
    forTenant<T>(
      tenantId: string,
      fn: (tx: TenantTransaction) => Promise<T>,
      options?: TransactionOptions,
    ) {
      if (!tenantId) {
        throw new Error('forTenant exige um tenantId');
      }
      return run((tx) => setCurrentTenant(tx, tenantId), fn, options);
    },
    asPlatformAdmin<T>(fn: (tx: TenantTransaction) => Promise<T>, options?: TransactionOptions) {
      return run(markPlatformAdmin, fn, options);
    },
    disconnect() {
      return prisma.$disconnect();
    },
  };
}

// Em dev o Next recarrega os módulos a cada edição; sem o cache no globalThis,
// cada reload abriria um pool novo e esgotaria as conexões do Postgres.
const globalForTenantDb = globalThis as unknown as { __kgTenantDb?: TenantDb };

export function getTenantDb(): TenantDb {
  if (!globalForTenantDb.__kgTenantDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL não definida — o client escopado não pode ser criado');
    }
    globalForTenantDb.__kgTenantDb = createTenantDb(connectionString);
  }
  return globalForTenantDb.__kgTenantDb;
}

export function forTenant<T>(
  tenantId: string,
  fn: (tx: TenantTransaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return getTenantDb().forTenant(tenantId, fn, options);
}

export function asPlatformAdmin<T>(
  fn: (tx: TenantTransaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return getTenantDb().asPlatformAdmin(fn, options);
}
