import type { BookingStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import type { BookingOccupancyStatus } from '@/lib/booking/availability';

/**
 * Guarda de deriva entre o enum do Prisma e a união local.
 *
 * `lib/booking/availability.ts` declara a própria união de status para não
 * importar Prisma — é o que mantém o módulo puro e testável sem banco. O preço
 * é duplicação: se alguém acrescentar um status no schema, a união local fica
 * para trás em silêncio e a grade passa a ignorar um estado real de agendamento.
 *
 * Este teste quase não roda nada: ele falha na COMPILAÇÃO se os dois conjuntos
 * deixarem de coincidir, que é exatamente quando queremos saber.
 */
describe('união local de status não deriva do enum do Prisma', () => {
  it('os dois conjuntos são mutuamente atribuíveis', () => {
    const daPrismaParaLocal: BookingOccupancyStatus = 'HOLD' as BookingStatus;
    const daLocalParaPrisma: BookingStatus = 'HOLD' as BookingOccupancyStatus;
    expect(daPrismaParaLocal).toBe(daLocalParaPrisma);
  });
});
