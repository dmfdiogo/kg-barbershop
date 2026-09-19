import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { WorkingHoursView } from './types';

/**
 * Conversões de tempo da equipe (tarefa F2.2).
 *
 * Dois formatos de "hora" convivem aqui e não podem ser confundidos:
 *
 *   1. Hora de PAREDE da jornada ("HH:mm"), gravada em `WorkingHours` como
 *      `@db.Time(0)` — a coluna não tem fuso, é o relógio do estabelecimento.
 *      O seed grava `new Date('1970-01-01T09:00:00Z')`; a leitura usa os getters
 *      UTC para não depender do fuso do processo.
 *   2. Instante UTC (`Date`), usado em `TimeOff`. A conversão de/para o relógio
 *      do tenant passa SEMPRE por `date-fns-tz`, nunca por `Date` local — é a
 *      regra do `contexto-comum.md` §3.2 (o bug do `getUTCDay()` no MVP antigo).
 */

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "HH:mm" → minutos desde a meia-noite. `null` quando inválido. */
export function timeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Minutos desde a meia-noite → "HH:mm". */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${pad2(hours)}:${pad2(rest)}`;
}

/**
 * Valor de `@db.Time(0)` → minutos desde a meia-noite. Usa os getters UTC de
 * propósito: a coluna `time` viaja como instante de 1970 em UTC.
 */
export function timeColumnToMinutes(value: Date | string): number | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }
  return timeToMinutes(value);
}

/** Minutos desde a meia-noite → valor para a coluna `@db.Time(0)`. */
export function minutesToTimeColumn(minutes: number): Date {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return new Date(Date.UTC(1970, 0, 1, hours, rest, 0));
}

/** `WorkingHours` do banco → view "HH:mm". */
export function toWorkingHoursView(row: {
  weekday: number;
  startTime: Date | string;
  endTime: Date | string;
}): WorkingHoursView | null {
  const start = timeColumnToMinutes(row.startTime);
  const end = timeColumnToMinutes(row.endTime);
  if (start === null || end === null) return null;
  return { weekday: row.weekday, startTime: minutesToTime(start), endTime: minutesToTime(end) };
}

/**
 * `datetime-local` ("YYYY-MM-DDTHH:mm") no relógio do tenant → instante UTC.
 * Devolve `null` quando o texto não casa com o formato ou a data não existe.
 */
export function localDateTimeToInstant(value: string, timezone: string): Date | null {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day, hours, minutes] = match;
  const parsed = fromZonedTime(`${year}-${month}-${day}T${hours}:${minutes}:00`, timezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Instante UTC → `datetime-local` ("YYYY-MM-DDTHH:mm") no fuso do tenant. */
export function instantToLocalDateTime(instant: Date, timezone: string): string {
  const zoned = toZonedTime(instant, timezone);
  return `${zoned.getFullYear()}-${pad2(zoned.getMonth() + 1)}-${pad2(zoned.getDate())}T${pad2(
    zoned.getHours(),
  )}:${pad2(zoned.getMinutes())}`;
}
