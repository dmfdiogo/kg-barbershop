// Erros de domínio do isolamento/agenda.
//
// A violação da exclusion constraint booking_no_overlap chega do Postgres como
// 23P01. Sem tradução, a F3 devolveria 500 para "horário ocupado" — e "horário
// ocupado" é fluxo esperado, não erro de servidor (plano §5.1 e
// fase-0-fundacao.md, armadilha do 23P01).

export const SLOT_UNAVAILABLE = 'SLOT_UNAVAILABLE' as const;

/**
 * O intervalo [startsAt, blockedUntil) do profissional já está ocupado por
 * outro agendamento com status HOLD, PENDING ou CONFIRMED.
 */
export class SlotUnavailableError extends Error {
  readonly code = SLOT_UNAVAILABLE;

  constructor(message = 'O horário acabou de ser reservado. Escolha outro.') {
    super(message);
    this.name = 'SlotUnavailableError';
  }
}

export function isSlotUnavailableError(error: unknown): error is SlotUnavailableError {
  return error instanceof SlotUnavailableError;
}

/**
 * Extrai o SQLSTATE do Postgres de um erro do Prisma 7 com driver adapter.
 *
 * O adapter embrulha o erro original em `meta.driverAdapterError.cause`; o
 * código aparece em `cause.code` (e em `cause.originalCode`). Retorna undefined
 * quando o erro não veio do banco.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const { meta } = error as { meta?: unknown };
  if (typeof meta === 'object' && meta !== null) {
    const { driverAdapterError } = meta as { driverAdapterError?: unknown };
    if (typeof driverAdapterError === 'object' && driverAdapterError !== null) {
      const { cause } = driverAdapterError as { cause?: unknown };
      if (typeof cause === 'object' && cause !== null) {
        const { code, originalCode } = cause as { code?: unknown; originalCode?: unknown };
        if (typeof code === 'string') return code;
        if (typeof originalCode === 'string') return originalCode;
      }
    }
  }

  // Erros do driver sem embrulho do Prisma (ex.: $queryRawUnsafe em versões
  // anteriores) expõem o SQLSTATE direto em `.code`.
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/**
 * Converte o 23P01 em SlotUnavailableError. Qualquer outro erro passa intacto.
 */
export function translatePostgresError(error: unknown): unknown {
  if (postgresErrorCode(error) === '23P01') {
    return new SlotUnavailableError();
  }
  return error;
}
