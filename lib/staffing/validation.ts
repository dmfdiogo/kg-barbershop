import { isE164 } from '@/lib/messaging/types';
import { localDateTimeToInstant, timeToMinutes } from './time';
import type {
  InviteFormInput,
  StaffFieldErrors,
  StaffServicesFormInput,
  TimeOffFormInput,
  ValidatedInvite,
  ValidatedTimeOff,
  ValidatedWeekday,
  WeeklyScheduleFormInput,
} from './types';

/**
 * Validação da equipe (tarefa F2.2). O servidor NUNCA confia no cliente: a tela
 * também valida, mas é aqui que se decide o que vai ao banco. Toda mensagem em
 * pt-BR, pronta para exibição.
 */

export const NAME_MAX = 120;
export const PHONE_MAX = 16;
export const REASON_MIN = 2;
export const REASON_MAX = 160;
export const MAX_RANGES_PER_DAY = 4;

export type InviteValidationResult =
  | { ok: true; value: ValidatedInvite }
  | { ok: false; fieldErrors: StaffFieldErrors };

export function validateInviteForm(input: InviteFormInput): InviteValidationResult {
  const fieldErrors: StaffFieldErrors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length > 0 && name.length < 2) {
    fieldErrors.name = 'Informe um nome de 2 a 120 caracteres.';
  } else if (name.length > NAME_MAX) {
    fieldErrors.name = 'Informe um nome de 2 a 120 caracteres.';
  }

  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (phone.length > PHONE_MAX || !isE164(phone)) {
    fieldErrors.phone = 'Informe o WhatsApp com DDI e DDD, ex.: +5548999999999.';
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { name, phone } };
}

export type ScheduleValidationResult =
  | { ok: true; value: ValidatedWeekday[] }
  | { ok: false; fieldErrors: StaffFieldErrors };

interface RawRange {
  start?: unknown;
  end?: unknown;
}

/**
 * Normaliza a jornada semanal. Cada dia pode ter 0, 1 ou mais faixas: duas
 * faixas no mesmo dia são o almoço (o seed de Bruna), e dia ausente é folga (o
 * seed de Tiago na segunda). Faixas não podem se sobrepor.
 */
export function validateWeeklySchedule(input: WeeklyScheduleFormInput): ScheduleValidationResult {
  if (!Array.isArray(input.schedule)) {
    return { ok: false, fieldErrors: { schedule: 'Jornada inválida.' } };
  }

  const byWeekday = new Map<number, { startMin: number; endMin: number }[]>();

  for (const rawDay of input.schedule) {
    if (typeof rawDay !== 'object' || rawDay === null) {
      return { ok: false, fieldErrors: { schedule: 'Jornada inválida.' } };
    }
    const day = rawDay as { weekday?: unknown; ranges?: unknown };
    const weekday = day.weekday;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { ok: false, fieldErrors: { schedule: 'Dia da semana inválido.' } };
    }
    if (byWeekday.has(weekday)) {
      return { ok: false, fieldErrors: { schedule: 'Dia da semana duplicado.' } };
    }
    const ranges = Array.isArray(day.ranges) ? day.ranges : [];
    if (ranges.length > MAX_RANGES_PER_DAY) {
      return { ok: false, fieldErrors: { schedule: 'No máximo 4 faixas por dia.' } };
    }

    const parsed: { startMin: number; endMin: number }[] = [];
    for (const rawRange of ranges) {
      const { start, end } = (rawRange ?? {}) as RawRange;
      const startMin = typeof start === 'string' ? timeToMinutes(start) : null;
      const endMin = typeof end === 'string' ? timeToMinutes(end) : null;
      if (startMin === null || endMin === null) {
        return { ok: false, fieldErrors: { schedule: 'Horário inválido. Use HH:mm.' } };
      }
      if (endMin <= startMin) {
        return { ok: false, fieldErrors: { schedule: 'O fim da faixa deve ser depois do início.' } };
      }
      parsed.push({ startMin, endMin });
    }

    parsed.sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < parsed.length; i += 1) {
      const previous = parsed[i - 1];
      const current = parsed[i];
      if (previous && current && current.startMin < previous.endMin) {
        return { ok: false, fieldErrors: { schedule: 'As faixas do dia não podem se sobrepor.' } };
      }
    }

    byWeekday.set(weekday, parsed);
  }

  const value = [...byWeekday.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekday, ranges]) => ({ weekday, ranges }));

  return { ok: true, value };
}

export type TimeOffValidationResult =
  | { ok: true; value: ValidatedTimeOff }
  | { ok: false; fieldErrors: StaffFieldErrors };

export function validateTimeOffForm(
  input: TimeOffFormInput,
  timezone: string,
): TimeOffValidationResult {
  const fieldErrors: StaffFieldErrors = {};

  const startsAtLocal = typeof input.startsAtLocal === 'string' ? input.startsAtLocal.trim() : '';
  const endsAtLocal = typeof input.endsAtLocal === 'string' ? input.endsAtLocal.trim() : '';

  const startsAt = localDateTimeToInstant(startsAtLocal, timezone);
  const endsAt = localDateTimeToInstant(endsAtLocal, timezone);

  if (!startsAt || !endsAt) {
    fieldErrors.timeOff = 'Preencha início e fim do bloqueio.';
  } else if (endsAt.getTime() <= startsAt.getTime()) {
    fieldErrors.timeOff = 'O fim do bloqueio deve ser depois do início.';
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    fieldErrors.reason = `Descreva o motivo em ${REASON_MIN} a ${REASON_MAX} caracteres.`;
  }

  if (Object.keys(fieldErrors).length > 0 || !startsAt || !endsAt) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, value: { startsAt, endsAt, reason } };
}

/** Ids de serviços habilitados, deduplicados e não vazios. */
export function normalizeServiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) seen.add(entry.trim());
  }
  return [...seen];
}

export function validateStaffServices(
  input: StaffServicesFormInput,
): { ok: true; serviceIds: string[] } | { ok: false; fieldErrors: StaffFieldErrors } {
  if (input.serviceIds !== undefined && !Array.isArray(input.serviceIds)) {
    return { ok: false, fieldErrors: { services: 'Seleção de serviços inválida.' } };
  }
  return { ok: true, serviceIds: normalizeServiceIds(input.serviceIds) };
}
