import { fromZonedTime } from 'date-fns-tz';
import { describe, expect, it } from 'vitest';
import {
  findBookingsOverlapping,
  findUncoveredBookings,
  intervalsOverlap,
  isIntervalCoveredBySchedule,
} from '@/lib/staffing/schedule';
import type { ValidatedWeekday } from '@/lib/staffing/types';

/**
 * Detecção pura de conflito de agenda (tarefa F2.2).
 *
 * O seed de Bruna é o modelo: Ter 10:00–12:00 e 13:00–19:00 — duas faixas no
 * mesmo dia, o almoço é a ausência entre elas. 2026-11-03 é terça.
 */
const TZ = 'America/Sao_Paulo';

const BRUNA: ValidatedWeekday[] = [
  { weekday: 2, ranges: [{ startMin: 600, endMin: 720 }, { startMin: 780, endMin: 1140 }] },
];

function local(date: string, time: string): Date {
  return fromZonedTime(`${date}T${time}:00`, TZ);
}

describe('cobertura da jornada', () => {
  it('cobre um agendamento inteiro dentro de uma faixa', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-03', '10:30'),
      local('2026-11-03', '11:00'),
      BRUNA,
      TZ,
    );
    expect(covered).toBe(true);
  });

  it('recusa o intervalo de almoço entre duas faixas', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-03', '12:10'),
      local('2026-11-03', '12:40'),
      BRUNA,
      TZ,
    );
    expect(covered).toBe(false);
  });

  it('recusa agendamento que cruza a fronteira entre faixas', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-03', '11:50'),
      local('2026-11-03', '13:10'),
      BRUNA,
      TZ,
    );
    expect(covered).toBe(false);
  });

  it('aceita quando o fim coincide exatamente com o fim da faixa', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-03', '11:30'),
      local('2026-11-03', '12:00'),
      BRUNA,
      TZ,
    );
    expect(covered).toBe(true);
  });

  it('recusa um dia sem jornada (folga de Tiago na segunda)', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-02', '14:00'),
      local('2026-11-02', '14:30'),
      BRUNA,
      TZ,
    );
    expect(covered).toBe(false);
  });

  it('recusa agendamento que cruza a meia-noite', () => {
    const covered = isIntervalCoveredBySchedule(
      local('2026-11-03', '23:30'),
      local('2026-11-04', '00:30'),
      [{ weekday: 2, ranges: [{ startMin: 0, endMin: 1439 }] }],
      TZ,
    );
    expect(covered).toBe(false);
  });
});

describe('listas de conflito', () => {
  it('separa somente os agendamentos descobertos pela jornada', () => {
    const bookings = [
      { id: 'ok', startsAt: local('2026-11-03', '10:00'), blockedUntil: local('2026-11-03', '10:40') },
      { id: 'gap', startsAt: local('2026-11-03', '12:00'), blockedUntil: local('2026-11-03', '12:40') },
      { id: 'late', startsAt: local('2026-11-03', '19:00'), blockedUntil: local('2026-11-03', '19:30') },
    ];

    const uncovered = findUncoveredBookings(bookings, BRUNA, TZ);
    expect(uncovered.map((booking) => booking.id)).toEqual(['gap', 'late']);
  });

  it('detecta sobreposição com um bloqueio pontual', () => {
    const bookings = [
      { id: 'inside', startsAt: local('2026-11-03', '10:00'), blockedUntil: local('2026-11-03', '10:40') },
      { id: 'outside', startsAt: local('2026-11-03', '15:00'), blockedUntil: local('2026-11-03', '15:30') },
    ];

    const overlapping = findBookingsOverlapping(
      bookings,
      local('2026-11-03', '09:30'),
      local('2026-11-03', '11:00'),
    );
    expect(overlapping.map((booking) => booking.id)).toEqual(['inside']);
  });

  it('sobreposição exige interseção real, não apenas contato', () => {
    const start = new Date('2026-11-03T13:00:00Z');
    expect(intervalsOverlap(start, new Date(start.getTime() + 30 * 60_000), new Date(start.getTime() + 30 * 60_000), new Date(start.getTime() + 60 * 60_000))).toBe(false);
  });
});
