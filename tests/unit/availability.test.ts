import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import {
  getAvailability,
  getAnyStaffAvailability,
  isBookingOccupying,
  isWithinCancellationWindow,
  cancellationWindowEndsAt,
  selectStaffForSlot,
  tenantDayRange,
  type AvailabilityInput,
  type BusyBooking,
  type StaffSchedule,
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

describe('getAvailability — antecedência mínima e máxima do tenant', () => {
  const NOW = new Date('2026-09-18T13:30:00.000Z'); // 10:30 BRT, um slot exato

  it('minAdvanceMinutes empurra o primeiro slot para além do intervalo', () => {
    const slots = getAvailability(input({ now: NOW, minAdvanceMinutes: 30 }));

    // 10:30 e 10:45 BRT estão dentro dos 30 min de antecedência.
    expect(slots).not.toContain('2026-09-18T13:30:00.000Z');
    expect(slots).not.toContain('2026-09-18T13:45:00.000Z');
    // 11:00 BRT é a primeira com 30 min de folga.
    expect(slots).toContain('2026-09-18T14:00:00.000Z');
  });

  it('minAdvanceMinutes zero mantém o slot no instante atual', () => {
    const slots = getAvailability(input({ now: NOW }));

    expect(slots).toContain('2026-09-18T13:30:00.000Z');
  });

  it('maxAdvanceMinutes limita o horizonte; null não limita', () => {
    const limited = getAvailability(input({ now: NOW, maxAdvanceMinutes: 60 }));

    expect(limited).toContain('2026-09-18T14:30:00.000Z');
    expect(limited).not.toContain('2026-09-18T14:45:00.000Z');

    const unlimited = getAvailability(input({ now: NOW, maxAdvanceMinutes: null }));
    expect(unlimited.at(-1)).toBe('2026-09-19T01:30:00.000Z');
  });

  it('rejeita antecedências negativas', () => {
    expect(() => getAvailability(input({ minAdvanceMinutes: -1 }))).toThrow(/minAdvanceMinutes/);
    expect(() => getAvailability(input({ maxAdvanceMinutes: -5 }))).toThrow(/maxAdvanceMinutes/);
  });
});

describe('getAvailability — holds e ocupação da agenda', () => {
  // 11:00 BRT — instante que alguns testes tentam reservar.
  const SLOT = '2026-09-18T14:00:00.000Z';

  function booking(
    status: BusyBooking['status'],
    holdExpiresAt: Date | null = null,
  ): BusyBooking {
    return {
      startsAt: new Date(SLOT),
      blockedUntil: new Date('2026-09-18T14:30:00.000Z'),
      status,
      holdExpiresAt,
    };
  }

  it('hold vigente (holdExpiresAt > now) ocupa o slot', () => {
    const slots = getAvailability(
      input({
        now: new Date('2026-09-18T13:00:00.000Z'),
        bookings: [booking('HOLD', new Date('2026-09-18T13:30:00.000Z'))],
      }),
    );

    expect(slots).not.toContain(SLOT);
    expect(slots).not.toContain('2026-09-18T13:45:00.000Z');
    expect(slots).toContain('2026-09-18T13:30:00.000Z');
  });

  it('hold VENCIDO (holdExpiresAt < now) não ocupa o slot', () => {
    const slots = getAvailability(
      input({
        now: new Date('2026-09-18T13:45:00.000Z'),
        bookings: [booking('HOLD', new Date('2026-09-18T13:30:00.000Z'))],
      }),
    );

    expect(slots).toContain(SLOT);
  });

  it('COMPLETED, CANCELLED e NO_SHOW nunca ocupam', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      const slots = getAvailability(
        input({ now: new Date('2026-09-18T13:00:00.000Z'), bookings: [booking(status)] }),
      );
      expect(slots).toContain(SLOT);
    }
  });

  it('status omitido ocupa — fail-closed para linhas sem status', () => {
    const slots = getAvailability(
      input({
        now: new Date('2026-09-18T13:00:00.000Z'),
        bookings: [{ startsAt: new Date(SLOT), blockedUntil: new Date('2026-09-18T14:30:00.000Z') }],
      }),
    );

    expect(slots).not.toContain(SLOT);
  });

  it('isBookingOccupying resume a regra para reuso', () => {
    const now = new Date('2026-09-18T13:45:00.000Z');
    expect(isBookingOccupying(booking('HOLD', new Date('2026-09-18T14:00:00.000Z')), now)).toBe(true);
    expect(isBookingOccupying(booking('HOLD', new Date('2026-09-18T13:30:00.000Z')), now)).toBe(false);
    // HOLD sem expiração é malformado: a constraint o barraria, então a grade
    // também o trata como ocupado (fail-closed).
    expect(isBookingOccupying(booking('HOLD', null), now)).toBe(true);
    expect(isBookingOccupying(booking('COMPLETED'), now)).toBe(false);
    expect(isBookingOccupying(booking('CANCELLED'), now)).toBe(false);
    expect(isBookingOccupying({ startsAt: new Date(SLOT), blockedUntil: new Date(SLOT) }, now)).toBe(true);
  });
});

describe('getAnyStaffAvailability — "qualquer profissional" une as grades', () => {
  const MORNING: StaffSchedule = {
    staffId: 'a',
    workingHours: [{ weekday: 5, startTime: '09:00', endTime: '12:00' }],
  };
  const AFTERNOON: StaffSchedule = {
    staffId: 'b',
    workingHours: [{ weekday: 5, startTime: '13:00', endTime: '18:00' }],
  };
  const NOW = new Date('2026-09-18T03:00:00.000Z'); // 00:00 BRT

  it('une jornadas diferentes, sem inventar slots no intervalo vazio', () => {
    const slots = getAnyStaffAvailability({
      date: FRIDAY,
      timezone: TIMEZONE,
      service: { durationMin: 30, bufferMin: 0 },
      staff: [MORNING, AFTERNOON],
      now: NOW,
    });

    expect(slots).toContain('2026-09-18T12:00:00.000Z'); // 09:00 BRT
    expect(slots).toContain('2026-09-18T16:00:00.000Z'); // 13:00 BRT
    expect(slots).not.toContain('2026-09-18T15:00:00.000Z'); // 12:00 BRT, buraco
  });

  it('não duplica slot quando as jornadas se sobrepõem', () => {
    const overlapping: StaffSchedule = {
      staffId: 'b',
      workingHours: MORNING.workingHours,
    };
    const slots = getAnyStaffAvailability({
      date: FRIDAY,
      timezone: TIMEZONE,
      service: { durationMin: 30, bufferMin: 0 },
      staff: [MORNING, overlapping],
      now: NOW,
    });

    expect(new Set(slots).size).toBe(slots.length);
  });

  it('agendamento de um profissional não esconde o slot se outro está livre', () => {
    const busyMorning: StaffSchedule = {
      ...MORNING,
      bookings: [
        { startsAt: new Date('2026-09-18T12:00:00.000Z'), blockedUntil: new Date('2026-09-18T12:30:00.000Z') },
      ],
    };
    const freeMorning: StaffSchedule = { ...MORNING, staffId: 'c' };
    const slots = getAnyStaffAvailability({
      date: FRIDAY,
      timezone: TIMEZONE,
      service: { durationMin: 30, bufferMin: 0 },
      staff: [busyMorning, freeMorning],
      now: NOW,
    });

    expect(slots).toContain('2026-09-18T12:00:00.000Z');
  });
});

describe('selectStaffForSlot — confirmação distribuindo carga', () => {
  const SLOT = '2026-09-18T12:00:00.000Z'; // 09:00 BRT
  const NOW = new Date('2026-09-18T03:00:00.000Z'); // 00:00 BRT

  function staff(staffId: string): StaffSchedule {
    return {
      staffId,
      workingHours: [{ weekday: 5, startTime: '09:00', endTime: '12:00' }],
    };
  }

  function choose(staffList: StaffSchedule[], loads?: Record<string, number>): string | null {
    return selectStaffForSlot({
      date: FRIDAY,
      timezone: TIMEZONE,
      service: { durationMin: 30, bufferMin: 0 },
      staff: staffList,
      slot: SLOT,
      now: NOW,
      loads,
    });
  }

  it('escolhe o profissional de menor carga, não o primeiro da lista', () => {
    expect(choose([staff('a'), staff('b'), staff('c')], { a: 5, b: 2, c: 2 })).toBe('b');
  });

  it('pula o profissional ocupado no slot', () => {
    const busy: StaffSchedule = {
      ...staff('a'),
      bookings: [
        { startsAt: new Date(SLOT), blockedUntil: new Date('2026-09-18T12:30:00.000Z'), status: 'CONFIRMED' },
      ],
    };

    expect(choose([busy, staff('b')], { a: 0, b: 9 })).toBe('b');
  });

  it('só oferece profissionais cuja jornada cobre o slot', () => {
    const afternoon: StaffSchedule = {
      staffId: 'b',
      workingHours: [{ weekday: 5, startTime: '13:00', endTime: '18:00' }],
    };

    expect(choose([staff('a'), afternoon])).toBe('a');
    expect(
      selectStaffForSlot({
        date: FRIDAY,
        timezone: TIMEZONE,
        service: { durationMin: 30, bufferMin: 0 },
        staff: [staff('a'), afternoon],
        slot: new Date('2026-09-18T16:00:00.000Z'), // 13:00 BRT
        now: NOW,
      }),
    ).toBe('b');
  });

  it('devolve null quando nenhum profissional está livre', () => {
    const busy = ['a', 'b', 'c'].map<StaffSchedule>((id) => ({
      ...staff(id),
      bookings: [
        { startsAt: new Date(SLOT), blockedUntil: new Date('2026-09-18T12:30:00.000Z'), status: 'CONFIRMED' },
      ],
    }));

    expect(choose(busy)).toBeNull();
  });

  it('não concentra tudo no mesmo profissional ao longo das confirmações', () => {
    const team = [staff('a'), staff('b'), staff('c')];
    const loads: Record<string, number> = {};
    const picks: string[] = [];

    for (let i = 0; i < 9; i += 1) {
      const chosen = choose(team, loads);
      expect(chosen).not.toBeNull();
      picks.push(chosen!);
      loads[chosen!] = (loads[chosen!] ?? 0) + 1;
    }

    const tally = picks.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});

    expect(new Set(picks).size).toBe(3);
    expect(tally).toEqual({ a: 3, b: 3, c: 3 });
  });
});
