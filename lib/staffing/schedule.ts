import { toZonedTime } from 'date-fns-tz';
import type { ValidatedWeekday } from './types';

/**
 * Núcleo puro da detecção de conflito de agenda (tarefa F2.2).
 *
 * O invariante do produto: reduzir jornada ou criar um bloqueio NÃO pode apagar
 * o agendamento em silêncio. Este módulo responde a pergunta "este agendamento
 * futuro deixaria de ser coberto?", sem tocar no banco — quem carrega os dados
 * e decide como reagir é `lib/staffing/members.ts`.
 *
 * Função pura e testável: nada de Prisma, nada de `now` implícito.
 */

export interface OccupyingBooking {
  id: string;
  startsAt: Date;
  /** `endsAt` + buffer do serviço — o mesmo intervalo que a constraint protege. */
  blockedUntil: Date;
}

function localParts(
  instant: Date,
  timezone: string,
): { year: number; month: number; day: number; weekday: number; minute: number } {
  const zoned = toZonedTime(instant, timezone);
  return {
    year: zoned.getFullYear(),
    month: zoned.getMonth(),
    day: zoned.getDate(),
    weekday: zoned.getDay(),
    minute: zoned.getHours() * 60 + zoned.getMinutes(),
  };
}

/**
 * O intervalo `[startsAt, blockedUntil)` cabe inteiro em alguma faixa da jornada
 * proposta, no dia local do tenant?
 *
 * Um agendamento que cruza a meia-noite nunca é coberto (nenhuma faixa de um dia
 * o contém) — é a resposta conservadora correta para a grade, que é diária.
 */
export function isIntervalCoveredBySchedule(
  startsAt: Date,
  blockedUntil: Date,
  schedule: readonly ValidatedWeekday[],
  timezone: string,
): boolean {
  const start = localParts(startsAt, timezone);
  const end = localParts(blockedUntil, timezone);

  if (start.year !== end.year || start.month !== end.month || start.day !== end.day) {
    return false;
  }

  const day = schedule.find((entry) => entry.weekday === start.weekday);
  if (!day) return false;

  return day.ranges.some((range) => range.startMin <= start.minute && end.minute <= range.endMin);
}

/**
 * Agendamentos futuros que a jornada proposta deixaria descobertos. A ordem é a
 * da entrada (já ordenada por início, em `members.ts`).
 */
export function findUncoveredBookings(
  bookings: readonly OccupyingBooking[],
  schedule: readonly ValidatedWeekday[],
  timezone: string,
): OccupyingBooking[] {
  return bookings.filter(
    (booking) =>
      !isIntervalCoveredBySchedule(booking.startsAt, booking.blockedUntil, schedule, timezone),
  );
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}

/** Agendamentos futuros que cruzam um bloqueio `[startsAt, endsAt)`. */
export function findBookingsOverlapping(
  bookings: readonly OccupyingBooking[],
  startsAt: Date,
  endsAt: Date,
): OccupyingBooking[] {
  return bookings.filter((booking) =>
    intervalsOverlap(booking.startsAt, booking.blockedUntil, startsAt, endsAt),
  );
}
