import { describe, expect, it } from 'vitest';
import {
  isSlotUnavailableError,
  postgresErrorCode,
  SlotUnavailableError,
  translatePostgresError,
} from '@/lib/tenant/errors';

// Formato real observado do Prisma 7 + @prisma/adapter-pg para a violação da
// exclusion constraint booking_no_overlap (P2039 embrulhando o SQLSTATE 23P01).
function cancellationOverlapError(): Error {
  return Object.assign(new Error('Invalid `prisma.booking.create()` invocation'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    meta: {
      modelName: 'Booking',
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode: '23P01',
          originalMessage: 'conflicting key value violates exclusion constraint "booking_no_overlap"',
          kind: 'postgres',
          code: '23P01',
          severity: 'ERROR',
        },
      },
    },
  });
}

describe('tradução de erros do Postgres', () => {
  it('extrai o SQLSTATE do embrulho do driver adapter', () => {
    expect(postgresErrorCode(cancellationOverlapError())).toBe('23P01');
  });

  it('converte 23P01 em SlotUnavailableError', () => {
    const translated = translatePostgresError(cancellationOverlapError());
    expect(translated).toBeInstanceOf(SlotUnavailableError);
    expect(isSlotUnavailableError(translated)).toBe(true);
    expect((translated as SlotUnavailableError).code).toBe('SLOT_UNAVAILABLE');
  });

  it('não mexe em outros erros', () => {
    const uniqueViolation = Object.assign(new Error('dup'), {
      code: 'P2002',
      meta: { driverAdapterError: { cause: { code: '23505' } } },
    });
    expect(translatePostgresError(uniqueViolation)).toBe(uniqueViolation);

    const plain = new Error('qualquer coisa');
    expect(translatePostgresError(plain)).toBe(plain);
    expect(postgresErrorCode(undefined)).toBeUndefined();
    expect(postgresErrorCode('erro')).toBeUndefined();
  });
});
