import type { MemberRole } from '@prisma/client';

/**
 * Contratos de equipe e jornadas (tarefa F2.2).
 *
 * Módulo seguro para o bundle do cliente: importa o enum do Prisma apenas como
 * TIPO (apagado na compilação), então nenhum valor do Prisma Client vaza para o
 * navegador. As listas de constantes ficam aqui para validação e para a UI sem
 * duplicar o enum em dois lugares.
 */

export type Role = MemberRole;

/** 0 = domingo … 6 = sábado, a mesma convenção de `Date.getDay()` e do schema. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'Domingo',
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
};

/**
 * Faixa de jornada de um dia. O intervalo de almoço NÃO é bloqueio: é a
 * ausência de jornada entre duas faixas (ex.: 10:00–12:00 e 13:00–19:00). Folga
 * semanal é simplesmente não ter faixa no `weekday` — as duas coisas que o seed
 * de Bruna (almoço) e Tiago (folga na segunda) expressam.
 */
export interface WorkingHoursView {
  weekday: number;
  /** "HH:mm" no fuso do tenant. */
  startTime: string;
  /** "HH:mm" no fuso do tenant. */
  endTime: string;
}

export interface StaffMemberView {
  /** `StaffProfile.id` — o "profissional". */
  id: string;
  /** `TenantMember.id` — o vínculo de acesso. */
  memberId: string;
  userId: string;
  name: string;
  phone: string;
  role: Role;
  bio: string | null;
  active: boolean;
  workingHours: WorkingHoursView[];
  /** Ids dos `Service` vinculados. */
  serviceIds: string[];
}

export interface TimeOffView {
  id: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

/** Agendamento que seria afetado por uma redução de jornada ou um bloqueio. */
export interface StaffConflictView {
  bookingId: string;
  customerName: string;
  serviceName: string;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  kind: 'SCHEDULE' | 'TIME_OFF';
}

/** Um dia proposto pela tela, já normalizado para minutos do dia. */
export interface ValidatedWeekday {
  weekday: number;
  ranges: { startMin: number; endMin: number }[];
}

export interface ValidatedTimeOff {
  startsAt: Date;
  endsAt: Date;
  reason: string;
}

export interface ValidatedInvite {
  name: string;
  phone: string;
}

export type StaffField = 'name' | 'phone' | 'schedule' | 'timeOff' | 'reason' | 'services';
export type StaffFieldErrors = Partial<Record<StaffField, string>>;

export interface InviteFormInput {
  name?: unknown;
  phone?: unknown;
}

export interface WeeklyScheduleFormInput {
  /** Array de `{ weekday, ranges: [{ start, end }] }` em "HH:mm". */
  schedule?: unknown;
  /** Decisão explícita do dono diante dos conflitos listados. */
  confirmConflicts?: unknown;
}

export interface TimeOffFormInput {
  /** "YYYY-MM-DDTHH:mm" no fuso do tenant. */
  startsAtLocal?: unknown;
  endsAtLocal?: unknown;
  reason?: unknown;
  confirmConflicts?: unknown;
}

export interface StaffServicesFormInput {
  serviceIds?: unknown;
}

export type StaffingErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICTS'
  | 'ALREADY_OWNER'
  | 'ERROR';

export interface StaffingFailure {
  ok: false;
  code: StaffingErrorCode;
  message: string;
  fieldErrors?: StaffFieldErrors;
  /** Presente em `CONFLICTS`: a lista que obriga a decisão explícita. */
  conflicts?: StaffConflictView[];
}

export type InviteMemberResult = { ok: true; member: StaffMemberView } | StaffingFailure;
export type WeeklyScheduleResult = { ok: true } | StaffingFailure;
export type TimeOffResult = { ok: true; timeOff: TimeOffView } | StaffingFailure;
export type StaffServicesResult = { ok: true; serviceIds: string[] } | StaffingFailure;
export type StaffMutationResult = { ok: true } | StaffingFailure;

/** Status que ainda ocupam a agenda — os mesmos do anti-overlap no banco. */
export const OCCUPYING_BOOKING_STATUSES = ['HOLD', 'PENDING', 'CONFIRMED'] as const;
