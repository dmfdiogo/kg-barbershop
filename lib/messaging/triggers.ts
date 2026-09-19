import { addDays, format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { BookingStatus } from '@prisma/client';
import { recordAuditLog } from '@/lib/audit/record';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import {
  cancelPendingNotificationJobsInTransaction,
  enqueueNotificationJobInTransaction,
} from './jobs';
import type { JobTemplateName } from './templates';

/**
 * Gatilhos de notificação (tarefa F6.1, fase-6 §2 e §3).
 *
 * QUEM CHAMA: o módulo de extensão `lib/booking/participants/notifications.ts`,
 * pelos eventos PÓS-COMMIT `BookingConfirmed` / `BookingCancelled` /
 * `BookingRescheduled` da F3.2 — nunca por participante de transação. O motivo
 * é o contrato: WhatsApp fora do ar não pode impedir alguém de marcar horário,
 * e um participante que lança aborta a confirmação inteira.
 *
 * O QUE ELE FAZ: traduz um evento de domínio em linhas de `NotificationJob`
 * (F6.0). Nada de envio aqui — quem envia é `/api/cron/send-notifications`.
 * Tudo o que este módulo escreve vive no banco, dentro de uma transação
 * escopada no tenant, então o retry do client escopado (`P2034`) é seguro.
 *
 * IDEMPOTÊNCIA: `enqueueNotificationJobInTransaction` já deduplica por
 * (tenant, agendamento, template). Reagir duas vezes ao mesmo evento não
 * duplica lembrete.
 *
 * FUSO: "24h antes" e "2h antes" são instantes absolutos, mas o SILÊNCIO
 * NOTURNO é avaliado no horário LOCAL do tenant (`Tenant.timezone`). Um
 * agendamento às 6h em São Paulo tem H-2 às 4h locais — dentro da janela de
 * silêncio, e por isso não sai. Nada de `getUTCHours()` para decidir isso.
 */

// ---------------------------------------------------------------------------
// Política de silêncio noturno
// ---------------------------------------------------------------------------

/** Faixa de horas locais em que mensagens agendadas não devem sair. */
export interface QuietHours {
  /** Hora local (0–23, inclusiva) em que o silêncio começa. */
  readonly startHour: number;
  /** Hora local (0–23, exclusiva) em que o silêncio termina. */
  readonly endHour: number;
}

export interface TriggerPolicy {
  /**
   * Janela de silêncio no fuso do tenant. `null` desliga o silêncio.
   * Configurável por ambiente nesta fase; a promoção a configuração por tenant
   * é decisão de schema da F6.2/F2.5 (ver relatório da tarefa).
   */
  readonly quietHours: QuietHours | null;
}

/** 21h–8h: cobre a madrugada sem engolir a manhã inteira. */
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 21, endHour: 8 };

export const DEFAULT_TRIGGER_POLICY: TriggerPolicy = { quietHours: DEFAULT_QUIET_HOURS };

export const QUIET_HOURS_START_ENV = 'NOTIFICATION_QUIET_START_HOUR';
export const QUIET_HOURS_END_ENV = 'NOTIFICATION_QUIET_END_HOUR';

function parseHour(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) return null;
  return parsed;
}

/**
 * Resolve a política a partir do ambiente. Sem as duas variáveis válidas usa o
 * padrão; com as duas, respeita a janela do operador. Uma variável só (ou fora
 * de 0–23) é configuração ambígua e cai no padrão — falhar para o lado silencioso
 * é melhor do que enviar de madrugada por causa de um typo.
 */
export function resolveTriggerPolicy(
  env: Record<string, string | undefined> = process.env,
): TriggerPolicy {
  const start = parseHour(env[QUIET_HOURS_START_ENV]);
  const end = parseHour(env[QUIET_HOURS_END_ENV]);
  if (start === null || end === null) return DEFAULT_TRIGGER_POLICY;
  if (start === end) return { quietHours: null };
  return { quietHours: { startHour: start, endHour: end } };
}

function localHour(date: Date, timezone: string): number {
  return Number(formatInTimeZone(date, timezone, 'H'));
}

/** `true` quando o instante cai na janela de silêncio local do tenant. */
export function isWithinQuietHours(
  date: Date,
  timezone: string,
  quietHours: QuietHours,
): boolean {
  const hour = localHour(date, timezone);
  if (quietHours.startHour < quietHours.endHour) {
    return hour >= quietHours.startHour && hour < quietHours.endHour;
  }
  // Janela que cruza a meia-noite (o caso normal: 21h → 8h).
  return hour >= quietHours.startHour || hour < quietHours.endHour;
}

/**
 * Próximo instante em que o silêncio termina, no fuso do tenant. Usa a DATA
 * local (não UTC) para decidir se o fim cai no mesmo dia ou no seguinte — é
 * exatamente aqui que o fuso do tenant importa.
 */
export function endOfQuietHours(date: Date, timezone: string, quietHours: QuietHours): Date {
  const day = formatInTimeZone(date, timezone, 'yyyy-MM-dd');
  const hour = localHour(date, timezone);
  const crossesMidnight = quietHours.startHour >= quietHours.endHour;
  const isEveningPart = crossesMidnight && hour >= quietHours.startHour;

  const releaseDay = addDays(new Date(`${day}T00:00:00`), isEveningPart ? 1 : 0);
  const releaseDate = format(releaseDay, 'yyyy-MM-dd');
  const releaseTime = `${String(quietHours.endHour).padStart(2, '0')}:00:00`;
  return fromZonedTime(`${releaseDate} ${releaseTime}`, timezone);
}

/**
 * Empurra um lembrete que cairia no silêncio para o fim da janela, desde que
 * ainda faça sentido: se o fim do silêncio já é depois do atendimento começar,
 * o lembrete é descartado (não há "antes" possível). Devolve `null` para
 * descartar.
 */
export function adjustForQuietHours(
  scheduledFor: Date,
  startsAt: Date,
  timezone: string,
  quietHours: QuietHours | null,
): Date | null {
  if (!quietHours) return scheduledFor;
  if (!isWithinQuietHours(scheduledFor, timezone, quietHours)) return scheduledFor;

  const release = endOfQuietHours(scheduledFor, timezone, quietHours);
  if (release.getTime() >= startsAt.getTime()) return null;
  return release;
}

// ---------------------------------------------------------------------------
// Cálculo dos lembretes
// ---------------------------------------------------------------------------

export const D1_OFFSET_MS = 24 * 60 * 60_000;
export const H2_OFFSET_MS = 2 * 60 * 60_000;

/**
 * Instante de um lembrete, ou `null` quando ele não deve existir. Três motivos
 * para não existir:
 *
 * 1. Agendamento criado tarde demais (menos de 24h não gera D-1; menos de 2h
 *    não gera H-2).
 * 2. O lembrete cairia no silêncio noturno e o fim do silêncio já é depois do
 *    atendimento (o caso "4h da manhã para um horário das 6h").
 * 3. O ajuste de silêncio cairia no passado em relação a `now`.
 */
export function reminderScheduledFor(
  offsetMs: number,
  startsAt: Date,
  now: Date,
  timezone: string,
  quietHours: QuietHours | null,
): Date | null {
  const target = new Date(startsAt.getTime() - offsetMs);
  if (target.getTime() < now.getTime()) return null;

  const adjusted = adjustForQuietHours(target, startsAt, timezone, quietHours);
  if (!adjusted) return null;
  if (adjusted.getTime() < now.getTime()) return null;
  return adjusted;
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

export interface EnqueuedTriggerJob {
  template: JobTemplateName;
  scheduledFor: Date;
  /** `true` quando já existia um job idêntico pendente (evento reentregue). */
  existing: boolean;
}

export interface SkippedTriggerJob {
  template: JobTemplateName;
  reason: string;
}

export interface TriggerResult {
  bookingId: string;
  enqueued: EnqueuedTriggerJob[];
  skipped: SkippedTriggerJob[];
  /** Jobs pendentes cancelados (cancelamento/remarcação). */
  canceled: number;
}

export interface TriggerInput {
  tenantId: string;
  bookingId: string;
  /** Instante do commit; injetável para determinismo em teste. */
  now?: Date;
  /** Injetável para teste; padrão resolvido do ambiente. */
  policy?: TriggerPolicy;
}

// ---------------------------------------------------------------------------
// Núcleo em transação
// ---------------------------------------------------------------------------

interface TriggerContext {
  now: Date;
  timezone: string;
  quietHours: QuietHours | null;
}

async function contextFor(
  tx: TenantTransaction,
  tenantId: string,
  now: Date,
  policy: TriggerPolicy,
): Promise<TriggerContext> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return { now, timezone: tenant.timezone, quietHours: policy.quietHours };
}

async function enqueue(
  tx: TenantTransaction,
  tenantId: string,
  bookingId: string,
  template: JobTemplateName,
  scheduledFor: Date,
  result: TriggerResult,
): Promise<void> {
  const job = await enqueueNotificationJobInTransaction(tx, {
    tenantId,
    bookingId,
    template,
    scheduledFor,
  });
  result.enqueued.push({ template, scheduledFor, existing: job.existing });
}

async function scheduleReminder(
  tx: TenantTransaction,
  tenantId: string,
  bookingId: string,
  template: JobTemplateName,
  offsetMs: number,
  startsAt: Date,
  context: TriggerContext,
  result: TriggerResult,
): Promise<void> {
  const scheduledFor = reminderScheduledFor(
    offsetMs,
    startsAt,
    context.now,
    context.timezone,
    context.quietHours,
  );
  if (!scheduledFor) {
    result.skipped.push({ template, reason: 'Fora da antecedência mínima ou no silêncio noturno.' });
    return;
  }
  await enqueue(tx, tenantId, bookingId, template, scheduledFor, result);
}

/**
 * Confirmação: mensagem imediata ao cliente, aviso do novo agendamento ao
 * profissional e os dois lembretes (D-1 e H-2) quando cabem.
 */
export async function scheduleBookingConfirmedNotificationsInTransaction(
  tx: TenantTransaction,
  input: TriggerInput,
): Promise<TriggerResult> {
  const now = input.now ?? new Date();
  const policy = input.policy ?? resolveTriggerPolicy();
  const context = await contextFor(tx, input.tenantId, now, policy);

  const booking = await tx.booking.findFirst({
    where: { id: input.bookingId, tenantId: input.tenantId },
    select: { id: true, status: true, startsAt: true },
  });

  const result: TriggerResult = {
    bookingId: input.bookingId,
    enqueued: [],
    skipped: [],
    canceled: 0,
  };
  if (!booking) {
    result.skipped.push({
      template: 'booking_confirmation',
      reason: 'Agendamento não encontrado neste tenant.',
    });
    return result;
  }
  if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
    result.skipped.push({
      template: 'booking_confirmation',
      reason: `Agendamento ${booking.status}; sem notificações de confirmação.`,
    });
    return result;
  }

  await enqueue(tx, input.tenantId, booking.id, 'booking_confirmation', now, result);
  await enqueue(tx, input.tenantId, booking.id, 'booking_created_staff', now, result);
  await scheduleReminder(
    tx,
    input.tenantId,
    booking.id,
    'booking_reminder_d1',
    D1_OFFSET_MS,
    booking.startsAt,
    context,
    result,
  );
  await scheduleReminder(
    tx,
    input.tenantId,
    booking.id,
    'booking_reminder_h2',
    H2_OFFSET_MS,
    booking.startsAt,
    context,
    result,
  );

  return result;
}

/**
 * Cancelamento: cancela TODOS os jobs pendentes do agendamento (nada pior que
 * lembrete de horário que não existe mais) e avisa cliente E profissional.
 * A ordem importa: cancela antes de enfileirar os avisos, senão os próprios
 * avisos seriam cancelados.
 */
export async function scheduleBookingCancelledNotificationsInTransaction(
  tx: TenantTransaction,
  input: TriggerInput,
): Promise<TriggerResult> {
  const now = input.now ?? new Date();

  const result: TriggerResult = {
    bookingId: input.bookingId,
    enqueued: [],
    skipped: [],
    canceled: 0,
  };

  const booking = await tx.booking.findFirst({
    where: { id: input.bookingId, tenantId: input.tenantId },
    select: { id: true, status: true },
  });
  if (!booking) {
    result.skipped.push({
      template: 'booking_cancelled_customer',
      reason: 'Agendamento não encontrado neste tenant.',
    });
    return result;
  }

  result.canceled = await cancelPendingNotificationJobsInTransaction(
    tx,
    input.tenantId,
    booking.id,
  );

  await enqueue(tx, input.tenantId, booking.id, 'booking_cancelled_customer', now, result);
  await enqueue(tx, input.tenantId, booking.id, 'booking_cancelled_staff', now, result);

  return result;
}

/**
 * Remarcação: avisa cliente E profissional do novo horário e reagenda os
 * lembretes do agendamento novo.
 *
 * O agendamento ANTIGO (cancelado pela F3.4) tem os lembretes neutralizados
 * pelo runner: `claimDueJobsForTenant` vê `status='CANCELLED'` no agendamento do
 * job e o marca `CANCELED` antes de enviar. O evento `BookingRescheduled` não
 * carrega o id do agendamento antigo, então o cancelamento antecipado não é
 * possível por aqui — a rede de segurança do runner é a garantia.
 */
export async function scheduleBookingRescheduledNotificationsInTransaction(
  tx: TenantTransaction,
  input: TriggerInput,
): Promise<TriggerResult> {
  const now = input.now ?? new Date();
  const policy = input.policy ?? resolveTriggerPolicy();
  const context = await contextFor(tx, input.tenantId, now, policy);

  const booking = await tx.booking.findFirst({
    where: { id: input.bookingId, tenantId: input.tenantId },
    select: { id: true, status: true, startsAt: true },
  });

  const result: TriggerResult = {
    bookingId: input.bookingId,
    enqueued: [],
    skipped: [],
    canceled: 0,
  };
  if (!booking) {
    result.skipped.push({
      template: 'booking_rescheduled_customer',
      reason: 'Agendamento não encontrado neste tenant.',
    });
    return result;
  }
  if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
    result.skipped.push({
      template: 'booking_rescheduled_customer',
      reason: `Agendamento ${booking.status}; sem notificações de remarcação.`,
    });
    return result;
  }

  await enqueue(tx, input.tenantId, booking.id, 'booking_rescheduled_customer', now, result);
  await enqueue(tx, input.tenantId, booking.id, 'booking_rescheduled_staff', now, result);
  await scheduleReminder(
    tx,
    input.tenantId,
    booking.id,
    'booking_reminder_d1',
    D1_OFFSET_MS,
    booking.startsAt,
    context,
    result,
  );
  await scheduleReminder(
    tx,
    input.tenantId,
    booking.id,
    'booking_reminder_h2',
    H2_OFFSET_MS,
    booking.startsAt,
    context,
    result,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Wrappers pós-commit (abrem a própria transação)
// ---------------------------------------------------------------------------

export function scheduleBookingConfirmedNotifications(input: TriggerInput): Promise<TriggerResult> {
  return forTenant(input.tenantId, (tx) =>
    scheduleBookingConfirmedNotificationsInTransaction(tx, input),
  );
}

export function scheduleBookingCancelledNotifications(input: TriggerInput): Promise<TriggerResult> {
  return forTenant(input.tenantId, (tx) =>
    scheduleBookingCancelledNotificationsInTransaction(tx, input),
  );
}

export function scheduleBookingRescheduledNotifications(
  input: TriggerInput,
): Promise<TriggerResult> {
  return forTenant(input.tenantId, (tx) =>
    scheduleBookingRescheduledNotificationsInTransaction(tx, input),
  );
}

// ---------------------------------------------------------------------------
// Confirmação de presença (botão do D-1)
// ---------------------------------------------------------------------------

export const ATTENDANCE_CONFIRMED_ACTION = 'booking.attendance_confirmed';

export class AttendanceConfirmationError extends Error {
  readonly code: 'INVALID_INPUT' | 'BOOKING_NOT_FOUND';

  constructor(code: 'INVALID_INPUT' | 'BOOKING_NOT_FOUND', message: string) {
    super(message);
    this.name = 'AttendanceConfirmationError';
    this.code = code;
  }
}

export interface AttendanceConfirmationInput {
  tenantId: string;
  bookingId: string;
}

export interface AttendanceConfirmationResult {
  bookingId: string;
  status: BookingStatus;
  /** `true` quando o botão já havia sido respondido (clique duplo). */
  alreadyResponded: boolean;
  /** Lembretes pendentes cancelados ao confirmar presença. */
  canceledReminders: number;
}

/**
 * Retorno do clique no botão de confirmação de presença do D-1.
 *
 * Não é UI: é o caminho de domínio que o webhook de resposta do botão (F8.3)
 * chama. Confirmar presença TORNA O H-2 DESNECESSÁRIO, então cancela os
 * lembretes pendentes e registra o consentimento/reação em `AuditLog`.
 *
 * O schema da F0 não tem coluna de presença no `Booking`; a marca do clique é o
 * `AuditLog` (`action = booking.attendance_confirmed`), que também serve de
 * idempotência. Gravar a presença como coluna é decisão de schema para a F8.3
 * (ver relatório), não desta tarefa.
 */
export async function confirmBookingAttendance(
  input: AttendanceConfirmationInput,
): Promise<AttendanceConfirmationResult> {
  if (!input.tenantId) {
    throw new AttendanceConfirmationError('INVALID_INPUT', 'tenantId é obrigatório.');
  }
  if (!input.bookingId) {
    throw new AttendanceConfirmationError('INVALID_INPUT', 'bookingId é obrigatório.');
  }

  return forTenant(input.tenantId, async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: input.bookingId, tenantId: input.tenantId },
      select: { id: true, status: true },
    });
    if (!booking) {
      throw new AttendanceConfirmationError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
    }

    const existing = await tx.auditLog.findFirst({
      where: {
        tenantId: input.tenantId,
        entity: 'Booking',
        entityId: booking.id,
        action: ATTENDANCE_CONFIRMED_ACTION,
      },
      select: { id: true },
    });
    if (existing) {
      return {
        bookingId: booking.id,
        status: booking.status,
        alreadyResponded: true,
        canceledReminders: 0,
      };
    }

    // Só lembretes: confirmar presença torna o H-2 (e um D-1 ainda não enviado)
    // desnecessários. A confirmação imediata e o aviso ao profissional são
    // transacionais e não são afetados pelo clique.
    const canceled = await tx.notificationJob.updateMany({
      where: {
        tenantId: input.tenantId,
        bookingId: booking.id,
        status: 'PENDING',
        template: { in: ['booking_reminder_d1', 'booking_reminder_h2'] },
      },
      data: { status: 'CANCELED', lockedAt: null },
    });
    await recordAuditLog(tx, {
      tenantId: input.tenantId,
      actorId: null,
      action: ATTENDANCE_CONFIRMED_ACTION,
      entity: 'Booking',
      entityId: booking.id,
    });

    return {
      bookingId: booking.id,
      status: booking.status,
      alreadyResponded: false,
      canceledReminders: canceled.count,
    };
  });
}
