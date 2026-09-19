import { addDays, parseISO } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Núcleo de domínio da grade de horários (tarefa F0.4, evoluído na F3.1).
 *
 * Portado de `backend/src/controllers/appointmentController.ts` (`getAvailability`),
 * com o cálculo de fuso corrigido: a jornada é interpretada no fuso do tenant
 * (`Tenant.timezone`), nunca em UTC. O código antigo usava `getUTCDay()`/
 * `setUTCHours()`, o que jogava um agendamento das 22h de Brasília para o dia
 * seguinte e fazia a busca do dia ignorá-lo (01h UTC do dia posterior).
 *
 * Este arquivo é puro: não importa Prisma nem banco. A F3.1 consulta o banco e
 * passa os dados já carregados para cá.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

export const DEFAULT_SLOT_INTERVAL_MIN = 15;

/** Jornada semanal de um profissional. `weekday` segue `Date.getDay()`: 0 = domingo. */
export interface WorkingHours {
  weekday: number;
  /** "HH:mm" no fuso do tenant. */
  startTime: string;
  /** "HH:mm" no fuso do tenant. */
  endTime: string;
}

/** Bloqueio pontual (almoço, folga, emergência) — instantes UTC. */
export interface TimeOff {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Só o que a grade precisa saber do `BookingStatus` do schema. Mantido como
 * união local para preservar a pureza do módulo (nenhum import de Prisma).
 */
export type BookingOccupancyStatus =
  | 'HOLD'
  | 'PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

/**
 * Agendamento que ocupa a agenda. `blockedUntil` = `endsAt` + buffer do serviço
 * (`plano-refatoracao.md` §4), ou seja, o intervalo que a constraint do banco
 * também protege.
 *
 * `status`/`holdExpiresAt` alimentam `isBookingOccupying`, que espelha a
 * exclusion constraint do banco. Quando `status` é omitido o agendamento ocupa
 * — preserva o contrato da F0.4 e é fail-closed para linhas sem status.
 */
export interface BusyBooking {
  startsAt: Date;
  blockedUntil: Date;
  status?: BookingOccupancyStatus;
  /** Só tem efeito para `status: 'HOLD'`. */
  holdExpiresAt?: Date | null;
}

export interface AvailabilityService {
  durationMin: number;
  bufferMin: number;
}

export interface AvailabilityInput {
  /** Dia local do tenant, no formato "YYYY-MM-DD". */
  date: string;
  /** Fuso do tenant (`Tenant.timezone`), ex.: "America/Sao_Paulo". */
  timezone: string;
  workingHours: WorkingHours[];
  service: AvailabilityService;
  bookings?: BusyBooking[];
  timeOff?: TimeOff[];
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
  /** Intervalo entre o início de slots consecutivos; padrão 15 min. */
  slotIntervalMin?: number;
  /** `Tenant.minAdvanceMinutes`: antecedência mínima para agendar. Padrão 0. */
  minAdvanceMinutes?: number;
  /**
   * `Tenant.maxAdvanceMinutes`: horizonte máximo para agendar. `null`/ausente =
   * sem limite (o padrão do schema).
   */
  maxAdvanceMinutes?: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/**
 * Instante UTC do início do dia local do tenant e do início do dia seguinte
 * (limite superior **exclusivo**). É o intervalo que a F3.1 deve usar na query
 * de agendamentos e bloqueios — a busca por dia UTC perde tudo entre 21h e 0h.
 */
export function tenantDayRange(date: string, timezone: string): { start: Date; end: Date } {
  assertValidDate(date);

  const nextDay = formatIsoDate(addDays(parseISO(date), 1));

  return {
    start: fromZonedTime(`${date}T00:00:00`, timezone),
    end: fromZonedTime(`${nextDay}T00:00:00`, timezone),
  };
}

/**
 * Decide se um agendamento ocupa a grade agora.
 *
 * Alinhado à exclusion constraint `booking_no_overlap`, que ocupa apenas com
 * `status IN ('HOLD','PENDING','CONFIRMED')`:
 *
 * - HOLD ocupa enquanto vigente: `holdExpiresAt > now`. Um hold vencido nunca
 *   aparece como ocupado — o horário volta à grade mesmo antes de a limpeza da
 *   F3.2 recolhê-lo. HOLD sem `holdExpiresAt` ocupa (fail-closed: a constraint
 *   também o barraria).
 * - COMPLETED, CANCELLED e NO_SHOW nunca ocupam.
 * - Qualquer outro status (ou `status` omitido) ocupa — fail-closed para linhas
 *   carregadas sem status.
 */
export function isBookingOccupying(booking: BusyBooking, now: Date): boolean {
  if (
    booking.status === 'COMPLETED' ||
    booking.status === 'CANCELLED' ||
    booking.status === 'NO_SHOW'
  ) {
    return false;
  }
  if (booking.status === 'HOLD') {
    return booking.holdExpiresAt == null || booking.holdExpiresAt.getTime() > now.getTime();
  }
  return true;
}

interface ResolvedOptions {
  now: Date;
  slotIntervalMin: number;
  minAdvanceMinutes: number;
  maxAdvanceMinutes: number | null;
}

interface DaySlotInput extends ResolvedOptions {
  /** Dia local do tenant, "YYYY-MM-DD". */
  date: string;
  timezone: string;
  workingHours: WorkingHours[];
  service: AvailabilityService;
  bookings: BusyBooking[];
  timeOff: TimeOff[];
}

/**
 * Gera os horários disponíveis de um dia, como instantes UTC em ISO 8601.
 * Regras: duração do serviço + buffer, intervalos de jornada, bloqueios,
 * agendamentos (holds vencidos não contam) e antecedência mínima/máxima.
 */
export function getAvailability(input: AvailabilityInput): string[] {
  const { date, timezone, workingHours, service, bookings = [], timeOff = [] } = input;

  assertValidDate(date);
  assertServiceDuration(service);
  const options = resolveOptions(input);

  return computeDaySlots({
    date,
    timezone,
    workingHours,
    service,
    bookings,
    timeOff,
    ...options,
  });
}

function computeDaySlots(input: DaySlotInput): string[] {
  const { date, timezone, workingHours, service, bookings, timeOff, now, slotIntervalMin } = input;

  const dayStart = fromZonedTime(`${date}T00:00:00`, timezone);
  // `toZonedTime` devolve o relógio de parede do tenant; `getDay()` daí é o dia
  // da semana local — nunca `getUTCDay()`.
  const weekday = toZonedTime(dayStart, timezone).getDay();

  const blockMs = (service.durationMin + service.bufferMin) * MINUTE_MS;
  const nowMs = now.getTime();
  const minAdvanceMs = input.minAdvanceMinutes * MINUTE_MS;
  const maxAdvanceMs = input.maxAdvanceMinutes === null ? null : input.maxAdvanceMinutes * MINUTE_MS;

  const busy = [
    ...bookings
      .filter((booking) => isBookingOccupying(booking, now))
      .map((booking) => ({
        start: booking.startsAt.getTime(),
        end: booking.blockedUntil.getTime(),
      })),
    ...timeOff.map((interval) => ({
      start: interval.startsAt.getTime(),
      end: interval.endsAt.getTime(),
    })),
  ];

  const slots = new Set<string>();

  for (const hours of workingHours) {
    if (hours.weekday !== weekday) continue;

    const startMinute = parseTimeToMinutes(hours.startTime);
    const endMinute = parseTimeToMinutes(hours.endTime);
    if (startMinute === null || endMinute === null) continue;
    if (endMinute <= startMinute) continue;

    for (let minute = startMinute; minute + service.durationMin <= endMinute; minute += slotIntervalMin) {
      const slotStart = slotInstant(date, minute, timezone);
      const slotStartMs = slotStart.getTime();

      const advanceMs = slotStartMs - nowMs;
      if (advanceMs < minAdvanceMs) continue;
      if (maxAdvanceMs !== null && advanceMs > maxAdvanceMs) continue;

      const slotBlockEndMs = slotStartMs + blockMs;
      const overlaps = busy.some((interval) => slotStartMs < interval.end && slotBlockEndMs > interval.start);
      if (overlaps) continue;

      slots.add(slotStart.toISOString());
    }
  }

  return [...slots].sort((a, b) => Date.parse(a) - Date.parse(b));
}

/** Agenda de um profissional no dia consultado (F3.1). */
export interface StaffSchedule {
  staffId: string;
  workingHours: WorkingHours[];
  bookings?: BusyBooking[];
  timeOff?: TimeOff[];
}

export interface AnyStaffAvailabilityInput {
  /** Dia local do tenant, no formato "YYYY-MM-DD". */
  date: string;
  timezone: string;
  service: AvailabilityService;
  staff: StaffSchedule[];
  now?: Date;
  slotIntervalMin?: number;
  minAdvanceMinutes?: number;
  maxAdvanceMinutes?: number | null;
}

/**
 * "Qualquer profissional": une as grades de todos os profissionais do serviço.
 * O slot aparece uma única vez, mesmo quando vários podem atendê-lo. Quem
 * escolhe o profissional na confirmação é `selectStaffForSlot`.
 */
export function getAnyStaffAvailability(input: AnyStaffAvailabilityInput): string[] {
  const { date, timezone, service, staff } = input;

  assertValidDate(date);
  assertServiceDuration(service);
  const options = resolveOptions(input);

  const union = new Set<string>();

  for (const member of staff) {
    const slots = computeDaySlots({
      date,
      timezone,
      workingHours: member.workingHours,
      service,
      bookings: member.bookings ?? [],
      timeOff: member.timeOff ?? [],
      ...options,
    });

    for (const slot of slots) union.add(slot);
  }

  return [...union].sort((a, b) => Date.parse(a) - Date.parse(b));
}

export interface SelectStaffForSlotInput {
  /** Dia local do tenant, "YYYY-MM-DD", coerente com a grade já exibida. */
  date: string;
  timezone: string;
  service: AvailabilityService;
  staff: StaffSchedule[];
  /** Slot pretendido (UTC), como devolvido por `getAnyStaffAvailability`. */
  slot: Date | string;
  /**
   * Carga atual por `staffId` — ex.: nº de agendamentos futuros (HOLD vigente ou
   * CONFIRMED). Ausente = 0. É o critério de distribuição.
   */
  loads?: Record<string, number>;
  now?: Date;
  slotIntervalMin?: number;
  minAdvanceMinutes?: number;
  maxAdvanceMinutes?: number | null;
}

/**
 * Escolhe, para um slot, o profissional livre de menor carga (`loads[staffId]`).
 * Empate resolve por `staffId`, em ordem estável. Retorna `null` se ninguém
 * puder atender.
 *
 * É a metade "na confirmação" do "qualquer profissional": a grade une as
 * agendas, e este seletor evita concentrar tudo no primeiro da lista. Quem
 * chama deve recontar/atualizar `loads` a cada escolha (somar o novo
 * agendamento, por exemplo) — é isso que produz a distribuição.
 */
export function selectStaffForSlot(input: SelectStaffForSlotInput): string | null {
  const { date, timezone, service, staff } = input;
  const slotDate = typeof input.slot === 'string' ? new Date(input.slot) : input.slot;
  assertFiniteDate(slotDate, 'slot');
  const slotIso = slotDate.toISOString();

  assertValidDate(date);
  assertServiceDuration(service);
  const options = resolveOptions(input);

  let selected: { staffId: string; load: number } | null = null;

  for (const member of staff) {
    const freeSlots = new Set(
      computeDaySlots({
        date,
        timezone,
        workingHours: member.workingHours,
        service,
        bookings: member.bookings ?? [],
        timeOff: member.timeOff ?? [],
        ...options,
      }),
    );

    if (!freeSlots.has(slotIso)) continue;

    const load = input.loads?.[member.staffId] ?? 0;
    if (
      selected === null ||
      load < selected.load ||
      (load === selected.load && member.staffId < selected.staffId)
    ) {
      selected = { staffId: member.staffId, load };
    }
  }

  return selected?.staffId ?? null;
}

export interface CancellationWindowInput {
  /** Início do agendamento (UTC). */
  startsAt: Date;
  /** `Tenant.cancellationWindowHours` — política por tenant, não constante. */
  cancellationWindowHours: number;
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
}

/**
 * Regra portada de `rescheduleAppointment`: o cliente só pode remarcar/cancelar
 * até `cancellationWindowHours` antes do atendimento. O antigo era fixo em 24h;
 * agora a janela vem do tenant (padrão 24h definido no schema da F0.2).
 */
export function isWithinCancellationWindow({
  startsAt,
  cancellationWindowHours,
  now = new Date(),
}: CancellationWindowInput): boolean {
  assertFiniteDate(startsAt, 'startsAt');
  if (!Number.isFinite(cancellationWindowHours) || cancellationWindowHours < 0) {
    throw new Error('Cancellation window hours must be a non-negative number');
  }

  return startsAt.getTime() - now.getTime() >= cancellationWindowHours * HOUR_MS;
}

/** Limite (UTC) a partir do qual remarcar/cancelar deixa de ser permitido. */
export function cancellationWindowEndsAt(startsAt: Date, cancellationWindowHours: number): Date {
  assertFiniteDate(startsAt, 'startsAt');
  if (!Number.isFinite(cancellationWindowHours) || cancellationWindowHours < 0) {
    throw new Error('Cancellation window hours must be a non-negative number');
  }

  return new Date(startsAt.getTime() - cancellationWindowHours * HOUR_MS);
}

function resolveOptions(input: {
  now?: Date;
  slotIntervalMin?: number;
  minAdvanceMinutes?: number;
  maxAdvanceMinutes?: number | null;
}): ResolvedOptions {
  const now = input.now ?? new Date();
  const slotIntervalMin = input.slotIntervalMin ?? DEFAULT_SLOT_INTERVAL_MIN;
  const minAdvanceMinutes = input.minAdvanceMinutes ?? 0;
  const maxAdvanceMinutes = input.maxAdvanceMinutes ?? null;

  if (slotIntervalMin <= 0) {
    throw new Error('Slot interval must be greater than zero');
  }
  if (!Number.isFinite(minAdvanceMinutes) || minAdvanceMinutes < 0) {
    throw new Error('minAdvanceMinutes must be a non-negative number');
  }
  if (maxAdvanceMinutes !== null && (!Number.isFinite(maxAdvanceMinutes) || maxAdvanceMinutes < 0)) {
    throw new Error('maxAdvanceMinutes must be null or a non-negative number');
  }

  return { now, slotIntervalMin, minAdvanceMinutes, maxAdvanceMinutes };
}

function assertServiceDuration(service: AvailabilityService): void {
  if (service.durationMin <= 0) {
    throw new Error('Service duration must be greater than zero');
  }
}

function slotInstant(date: string, minuteOfDay: number, timezone: string): Date {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return fromZonedTime(`${date}T${pad(hours)}:${pad(minutes)}:00`, timezone);
}

function parseTimeToMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value);
  if (!match) return null;

  const [, hoursRaw, minutesRaw] = match;
  if (hoursRaw === undefined || minutesRaw === undefined) return null;

  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function assertValidDate(date: string): void {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }

  const parsed = parseISO(date);
  if (Number.isNaN(parsed.getTime()) || formatIsoDate(parsed) !== date) {
    throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  }
}

function assertFiniteDate(value: Date, field: string): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} must be a valid Date`);
  }
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
