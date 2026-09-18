import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import {
  getAvailability,
  isWithinCancellationWindow,
  cancellationWindowEndsAt,
  tenantDayRange,
  type AvailabilityInput,
} from '@/lib/booking/availability';

const TIMEZONE = 'America/Sao_Paulo';
// 2026-09-18 é uma sexta-feira (weekday 5).
const FRIDAY = '2026-09-18';

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    date: FRIDAY,
    timezone: TIMEZONE,
    workingHours: [{ weekday: 5, startTime: '09:00', endTime: '23:00' }],
    service: { durationMin: 30, bufferMin: 0 },
    now: new Date('2026-09-18T03:00:00.000Z'), // 00:00 em Brasília
    ...overrides,
  };
}

describe('tenantDayRange', () => {
  it('devolve a janela do dia local do tenant, não a do dia UTC', () => {
    const { start, end } = tenantDayRange(FRIDAY, TIMEZONE);

    expect(start.toISOString()).toBe('2026-09-18T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-19T03:00:00.000Z');
  });

  it('contém o agendamento das 22h de Brasília, que em UTC é 01h do dia seguinte', () => {
    const { start, end } = tenantDayRange(FRIDAY, TIMEZONE);
    const appointment = new Date('2026-09-19T01:00:00.000Z');

    expect(appointment.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(appointment.getTime()).toBeLessThan(end.getTime());

    // A janela "dia UTC" usada pelo código antigo (00:00Z–23:59Z de 18/09)
    // perde justamente esse agendamento — origem do bug 2.4.3.
    const legacyUtcDayStart = new Date(`${FRIDAY}T00:00:00.000Z`);
    const legacyUtcDayEnd = new Date(`${FRIDAY}T23:59:59.999Z`);
    expect(appointment.getTime()).toBeGreaterThan(legacyUtcDayEnd.getTime());
    expect(appointment.getTime()).toBeGreaterThan(legacyUtcDayStart.getTime());
  });
});

describe('getAvailability — fuso do tenant', () => {
  it('gera o slot das 22h de Brasília no dia certo (01h UTC do dia seguinte)', () => {
    const slots = getAvailability(input());

    // 22:30 BRT é o último slot possível (jornada até 23:00).
    const lastSlot = slots.at(-1);
    expect(lastSlot).toBe('2026-09-19T01:30:00.000Z');
    expect(formatInTimeZone(new Date(lastSlot!), TIMEZONE, 'yyyy-MM-dd HH:mm')).toBe('2026-09-18 22:30');
  });

  it('um agendamento das 22h de Brasília bloqueia os slots que colidem, mas não o anterior', () => {
    const slots = getAvailability(
      input({
        bookings: [
          {
            // 22:00–22:30 BRT (01:00–01:30 UTC do dia 19).
            startsAt: new Date('2026-09-19T01:00:00.000Z'),
            blockedUntil: new Date('2026-09-19T01:30:00.000Z'),
          },
        ],
      }),
    );

    expect(slots).not.toContain('2026-09-19T01:00:00.000Z');
    expect(slots).not.toContain('2026-09-19T00:45:00.000Z'); // 21:45 BRT colide com 22:00
    expect(slots).toContain('2026-09-19T00:30:00.000Z'); // 21:30 BRT termina exatamente às 22:00
    expect(slots).toContain('2026-09-19T01:30:00.000Z'); // 22:30 BRT começa quando o outro termina
  });

  it('não gera slot em dia sem jornada (domingo não tem working hours de sexta)', () => {
    const slots = getAvailability(input({ date: '2026-09-20' })); // domingo

    expect(slots).toEqual([]);
  });

  it('respeita o fuso do tenant ao decidir o dia da semana', () => {
    // 2026-09-19 00:00 em Brasília é sábado (weekday 6); a jornada é de sexta.
    const slots = getAvailability(
      input({
        date: '2026-09-19',
        now: new Date('2026-09-19T03:00:00.000Z'),
      }),
    );

    expect(slots).toEqual([]);
  });

  it('rejeita data fora do formato YYYY-MM-DD', () => {
    expect(() => getAvailability(input({ date: '18/09/2026' }))).toThrow(/YYYY-MM-DD/);
  });
});

describe('getAvailability — duração, buffer, intervalos e bloqueios', () => {
  it('aplica duração + buffer sobre o agendamento existente', () => {
    const slots = getAvailability(
      input({
        workingHours: [{ weekday: 5, startTime: '09:00', endTime: '12:00' }],
        service: { durationMin: 30, bufferMin: 15 },
        bookings: [
          {
            // 09:00–09:30 BRT, com 15 min de buffer: bloqueia até 09:45.
            startsAt: new Date('2026-09-18T12:00:00.000Z'),
            blockedUntil: new Date('2026-09-18T12:45:00.000Z'),
          },
        ],
      }),
    );

    // 09:00 e 09:15 e 09:30 BRT colidem com o atendimento + buffer.
    expect(slots).not.toContain('2026-09-18T12:00:00.000Z');
    expect(slots).not.toContain('2026-09-18T12:15:00.000Z');
    expect(slots).not.toContain('2026-09-18T12:30:00.000Z');
    // 09:45 BRT começa exatamente quando o buffer termina.
    expect(slots).toContain('2026-09-18T12:45:00.000Z');
    expect(slots).toContain('2026-09-18T13:00:00.000Z'); // 10:00 BRT, depois do buffer
  });

  it('considera o buffer do serviço novo para não encostar no próximo atendimento', () => {
    const slots = getAvailability(
      input({
        workingHours: [{ weekday: 5, startTime: '09:00', endTime: '14:00' }],
        service: { durationMin: 60, bufferMin: 30 },
        bookings: [
          {
            // Atendimento existente às 11:00 BRT.
            startsAt: new Date('2026-09-18T14:00:00.000Z'),
            blockedUntil: new Date('2026-09-18T15:00:00.000Z'),
          },
        ],
      }),
    );

    // Slot de 09:30 BRT terminaria 10:30 e, com buffer de 30, iria até 11:00 —
    // encosta no agendamento, mas não invade: pode.
    expect(slots).toContain('2026-09-18T12:30:00.000Z');
    // Slot de 09:45 BRT iria até 11:15 e invadiria o agendamento das 11:00.
    expect(slots).not.toContain('2026-09-18T12:45:00.000Z');
    expect(slots).toContain('2026-09-18T12:00:00.000Z'); // 09:00 BRT + 60 + 30 = 10:30, ok
  });

  it('respeita bloqueios pontuais (almoço)', () => {
    const slots = getAvailability(
      input({
        workingHours: [{ weekday: 5, startTime: '09:00', endTime: '14:00' }],
        timeOff: [
          {
            startsAt: new Date('2026-09-18T15:00:00.000Z'), // 12:00 BRT
            endsAt: new Date('2026-09-18T16:00:00.000Z'), // 13:00 BRT
          },
        ],
      }),
    );

    expect(slots).not.toContain('2026-09-18T15:00:00.000Z');
    expect(slots).not.toContain('2026-09-18T14:45:00.000Z'); // 11:45 BRT + 30 invade o almoço
    expect(slots).toContain('2026-09-18T14:30:00.000Z'); // 11:30 BRT termina 12:00
    expect(slots).toContain('2026-09-18T16:00:00.000Z'); // 13:00 BRT, almoço acabou
  });

  it('não gera slots no passado', () => {
    const slots = getAvailability(
      input({ now: new Date('2026-09-18T13:20:00.000Z') }), // 10:20 BRT
    );

    expect(slots[0]).toBe('2026-09-18T13:30:00.000Z'); // 10:30 BRT
    expect(slots).not.toContain('2026-09-18T13:15:00.000Z'); // 10:15 BRT
  });

  it('gera slots a cada 15 minutos e para quando não cabe a duração', () => {
    const slots = getAvailability(
      input({ workingHours: [{ weekday: 5, startTime: '09:00', endTime: '10:00' }] }),
    );

    expect(slots).toEqual([
      '2026-09-18T12:00:00.000Z', // 09:00
      '2026-09-18T12:15:00.000Z', // 09:15
      '2026-09-18T12:30:00.000Z', // 09:30 (09:30 + 30 = 10:00, limite)
    ]);
  });

  it('une jornadas sobrepostas sem duplicar slot', () => {
    const slots = getAvailability(
      input({
        workingHours: [
          { weekday: 5, startTime: '09:00', endTime: '12:00' },
          { weekday: 5, startTime: '11:00', endTime: '13:00' },
        ],
      }),
    );

    expect(new Set(slots).size).toBe(slots.length);
    expect(slots).toContain('2026-09-18T12:00:00.000Z');
    expect(slots.at(-1)).toBe('2026-09-18T15:30:00.000Z'); // 12:30 BRT
  });
});

describe('política de cancelamento/remarcação (Tenant.cancellationWindowHours)', () => {
  const startsAt = new Date('2026-09-19T12:00:00.000Z');
  const now = new Date('2026-09-18T12:00:00.000Z'); // 24h antes

  it('permite quando falta exatamente a janela configurada', () => {
    expect(isWithinCancellationWindow({ startsAt, cancellationWindowHours: 24, now })).toBe(true);
  });

  it('bloqueia dentro da janela', () => {
    expect(isWithinCancellationWindow({ startsAt, cancellationWindowHours: 25, now })).toBe(false);
  });

  it('a janela vem do tenant, não de uma constante de 24h', () => {
    expect(isWithinCancellationWindow({ startsAt, cancellationWindowHours: 6, now })).toBe(true);
    expect(isWithinCancellationWindow({ startsAt, cancellationWindowHours: 48, now })).toBe(false);
  });

  it('calcula o limite em que a remarcação deixa de ser permitida', () => {
    expect(cancellationWindowEndsAt(startsAt, 24).toISOString()).toBe('2026-09-18T12:00:00.000Z');
  });
});
