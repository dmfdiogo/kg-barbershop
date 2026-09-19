import type { Booking, NotificationStatus } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { ptBR } from 'date-fns/locale/pt-BR';
import { listAllTenantIds } from '@/lib/tenant/context';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import { getAppDomain } from '@/lib/tenant/slugs';
import { getWhatsAppProvider } from './index';
import {
  TEMPLATES,
  isJobTemplateName,
  type JobTemplateName,
} from './templates';
import { isE164, type E164, type WhatsAppProvider } from './types';

/**
 * Trabalhos de notificação persistidos (tarefa F6.0, fase-6 §1).
 *
 * Um lembrete NÃO é um `setTimeout`: em ambiente serverless o timer não
 * sobrevive ao deploy e o lembrete simplesmente não acontece. Ele é uma linha
 * em `NotificationJob`, criada quando o evento de agendamento ocorre (F6.1) e
 * coletada por `/api/cron/send-notifications` a cada 5 minutos.
 *
 * IDEMPOTÊNCIA: cron sobreposto não envia duas vezes. A reivindicação é um
 * `UPDATE ... RETURNING` com `FOR UPDATE SKIP LOCKED` — o primeiro worker marca
 * a linha como `SENDING` e commita; o segundo não a encontra mais como
 * `PENDING` e segue em frente. O envio em si acontece FORA da transação (é
 * chamada externa, e a callback do client escopado pode rodar duas vezes); a
 * marcação de sucesso/falha é uma segunda transação curta.
 *
 * TUDO no banco, nada em memória: é o que o retry do client escopado exige
 * (`contexto-comum.md` §4) e o que faz o trabalho sobreviver ao deploy.
 */

/** Tentativas por job antes do estado final `FAILED`. */
export const MAX_JOB_ATTEMPTS = 5;

/** Tamanho do lote por tenant em cada passada do cron. */
export const JOB_BATCH_SIZE = 50;

/** Depois disto um job é tarde demais para valer a pena (janela de tolerância). */
export const JOB_TOLERANCE_MS = 24 * 60 * 60_000;

/** Um job preso em `SENDING` além disto é considerado órfão e pode ser recolhido. */
export const JOB_LOCK_TIMEOUT_MS = 5 * 60_000;

const MINUTE_MS = 60_000;

/**
 * Backoff exponencial entre tentativas. O atraso cresce com o número de
 * tentativas já feitas e estaciona no teto — sem isso um provider fora do ar
 * geraria uma tempestade de retentativas.
 */
export function notificationBackoffMs(attempt: number): number {
  const schedule = [1 * MINUTE_MS, 5 * MINUTE_MS, 15 * MINUTE_MS, 60 * MINUTE_MS];
  const index = Math.max(0, Math.min(attempt - 1, schedule.length - 1));
  return schedule[index] ?? schedule[schedule.length - 1]!;
}

// ---------------------------------------------------------------------------
// Enfileiramento
// ---------------------------------------------------------------------------

export interface EnqueueNotificationJobInput {
  tenantId: string;
  bookingId: string;
  template: JobTemplateName;
  scheduledFor: Date;
}

export interface EnqueuedNotificationJob {
  id: string;
  /** `true` quando já existia um job pendente idêntico (enfileiramento idempotente). */
  existing: boolean;
}

/**
 * Cria um job DENTRO de uma transação já escopada. É a forma atômica: o job
 * nasce junto com a mudança de estado que o justifica (ex.: cancelar o
 * agendamento e cancelar os lembretes na mesma transação, F6.1).
 *
 * Idempotente por (tenantId, bookingId, template): se já existe um job
 * pendente ou em envio para o mesmo template do mesmo agendamento, devolve o
 * existente em vez de duplicar. É o que torna seguro reagir a um evento que
 * chegue duas vezes.
 */
export async function enqueueNotificationJobInTransaction(
  tx: TenantTransaction,
  input: EnqueueNotificationJobInput,
): Promise<EnqueuedNotificationJob> {
  const existing = await tx.notificationJob.findFirst({
    where: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      template: input.template,
      status: { in: ['PENDING', 'SENDING'] },
    },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { id: existing.id, existing: true };

  const created = await tx.notificationJob.create({
    data: {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      template: input.template,
      scheduledFor: input.scheduledFor,
      status: 'PENDING',
    },
    select: { id: true },
  });
  return { id: created.id, existing: false };
}

/**
 * Igual a `enqueueNotificationJobInTransaction`, mas abre a própria transação.
 * É o caminho dos handlers PÓS-COMMIT da F6.1: o agendamento já commitou e o
 * job é criado num segundo momento, de propósito (WhatsApp fora do ar não pode
 * impedir alguém de marcar horário).
 */
export async function enqueueNotificationJob(
  input: EnqueueNotificationJobInput,
): Promise<EnqueuedNotificationJob> {
  return forTenant(input.tenantId, (tx) => enqueueNotificationJobInTransaction(tx, input));
}

/**
 * Cancela os jobs pendentes de um agendamento (ex.: cancelamento). Devolve
 * quantos foram cancelados. Não toca em jobs já enviados — o histórico de
 * entrega é o que explica ao piloto "o cliente diz que não recebeu".
 */
export async function cancelPendingNotificationJobs(
  tenantId: string,
  bookingId: string,
): Promise<number> {
  const result = await forTenant(tenantId, (tx) =>
    tx.notificationJob.updateMany({
      where: { tenantId, bookingId, status: 'PENDING' },
      data: { status: 'CANCELED', lockedAt: null },
    }),
  );
  return result.count;
}

// ---------------------------------------------------------------------------
// Resolução do destinatário e das variáveis (a partir do agendamento)
// ---------------------------------------------------------------------------

export interface ResolvedDelivery {
  to: E164;
  vars: Record<string, string>;
}

interface DeliveryContext {
  tenantName: string;
  timezone: string;
  customerName: string;
  customerPhone: string | null;
  staffName: string;
  staffPhone: string | null;
  serviceName: string;
}

async function loadDeliveryContext(
  tx: TenantTransaction,
  tenantId: string,
  booking: Booking,
): Promise<DeliveryContext | null> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, timezone: true },
  });
  if (!tenant) return null;

  const service = await tx.service.findUnique({
    where: { id: booking.serviceId },
    select: { name: true },
  });

  const staffMemberLink = await tx.staffProfile.findUnique({
    where: { id: booking.staffId },
    select: { tenantMemberId: true },
  });
  const staffMember = staffMemberLink
    ? await tx.tenantMember.findUnique({
        where: { id: staffMemberLink.tenantMemberId },
        select: { userId: true },
      })
    : null;
  const staffUser = staffMember
    ? await tx.user.findUnique({
        where: { id: staffMember.userId },
        select: { name: true, phone: true },
      })
    : null;

  const customerMember = booking.customerId
    ? await tx.tenantMember.findUnique({
        where: { id: booking.customerId },
        select: { userId: true },
      })
    : null;
  const customerUser = customerMember
    ? await tx.user.findUnique({
        where: { id: customerMember.userId },
        select: { name: true, phone: true },
      })
    : null;

  return {
    tenantName: tenant.name,
    timezone: tenant.timezone,
    customerName: customerUser?.name ?? '',
    customerPhone: customerUser?.phone ?? null,
    staffName: staffUser?.name ?? '',
    staffPhone: staffUser?.phone ?? null,
    serviceName: service?.name ?? '',
  };
}

function appBaseUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const domain = getAppDomain();
  const scheme = domain.startsWith('localhost') || domain.includes('127.0.0.1') ? 'http' : 'https';
  return `${scheme}://${domain}`;
}

function formatStartsAt(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/**
 * Monta as variáveis DECLARADAS no template. Passar só o que o registro aceita
 * é intencional: uma variável a mais o provider recusaria
 * (`UNKNOWN_TEMPLATE_VARIABLE`) em produção, então a recusa já vale aqui.
 *
 * `address` não existe como coluna no schema congelado da F0; usa-se o nome do
 * estabelecimento como fallback e o Maps busca por esse nome. Quando o produto
 * tiver endereço estruturado, só este ponto muda.
 */
export function buildTemplateVariables(
  template: JobTemplateName,
  booking: Booking,
  context: DeliveryContext,
): Record<string, string> {
  const startsAt = formatStartsAt(booking.startsAt, context.timezone);
  const values: Record<string, string> = {
    customer_name: context.customerName,
    staff_name: context.staffName,
    service_name: context.serviceName,
    starts_at: startsAt,
    new_starts_at: startsAt,
    old_starts_at: '',
    address: context.tenantName,
    maps_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      context.tenantName,
    )}`,
    confirmation_url: `${appBaseUrl()}/confirmacao/${booking.id}`,
  };

  return Object.fromEntries(
    TEMPLATES[template].variables.map((variable) => [variable, values[variable] ?? '']),
  );
}

async function resolveDelivery(
  tx: TenantTransaction,
  tenantId: string,
  booking: Booking,
  template: JobTemplateName,
): Promise<ResolvedDelivery | null> {
  const context = await loadDeliveryContext(tx, tenantId, booking);
  if (!context) return null;

  const audience = TEMPLATES[template].audience;
  const phone = audience === 'STAFF' ? context.staffPhone : context.customerPhone;
  if (!phone || !isE164(phone)) return null;

  return { to: phone, vars: buildTemplateVariables(template, booking, context) };
}

// ---------------------------------------------------------------------------
// Reivindicação (claim) e execução
// ---------------------------------------------------------------------------

interface ClaimRow {
  id: string;
  booking_id: string | null;
  template: string;
  attempts: number;
  scheduled_for: Date;
}

export interface ClaimedNotificationJob {
  id: string;
  tenantId: string;
  bookingId: string;
  template: JobTemplateName;
  attempts: number;
  scheduledFor: Date;
  delivery: ResolvedDelivery;
}

interface ClaimResult {
  jobs: ClaimedNotificationJob[];
  failed: number;
  skipped: number;
  canceled: number;
}

/**
 * Reivindica jobs vencidos de UM tenant. A cláusula `FOR UPDATE SKIP LOCKED`
 * dentro do `UPDATE ... RETURNING` é o lock: outra execução concorrente não
 * bloqueia nem pega as mesmas linhas.
 *
 * Jobs em `SENDING` cujo lock venceu (worker morreu no meio) são recolhidos —
 * é a recuperação de órfão, ao custo de poder reenviar uma mensagem que o
 * primeiro worker já havia enviado. O limite de tentativas confina o dano.
 *
 * A função devolve apenas jobs PRONTOS para envio; os que não podem ser
 * enviados (sem booking, template desconhecido, fora da janela, cancelados) são
 * marcados aqui mesmo, na transação de claim.
 */
async function claimDueJobsForTenant(
  tenantId: string,
  now: Date,
  limit: number,
  lockTimeoutMs: number,
  toleranceMs: number,
): Promise<ClaimResult> {
  const staleBefore = new Date(now.getTime() - lockTimeoutMs);

  return forTenant(tenantId, async (tx) => {
    const rows = await tx.$queryRaw<ClaimRow[]>`
      WITH due AS (
        SELECT id FROM notification_job
        WHERE (status = 'PENDING' AND scheduled_for <= ${now} AND attempts < ${MAX_JOB_ATTEMPTS})
           OR (
             status = 'SENDING'
             AND locked_at IS NOT NULL
             AND locked_at <= ${staleBefore}
             AND attempts < ${MAX_JOB_ATTEMPTS}
           )
        ORDER BY scheduled_for ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE notification_job AS j
      SET status = 'SENDING',
          locked_at = ${now},
          attempts = j.attempts + 1,
          updated_at = ${now}
      FROM due
      WHERE j.id = due.id
      RETURNING j.id, j.booking_id, j.template, j.attempts, j.scheduled_for
    `;

    const result: ClaimResult = { jobs: [], failed: 0, skipped: 0, canceled: 0 };

    const finish = async (id: string, status: NotificationStatus, lastError: string) => {
      await tx.notificationJob.update({
        where: { id },
        data: { status, lockedAt: null, lastError },
      });
      if (status === 'FAILED') result.failed += 1;
      else if (status === 'CANCELED') result.canceled += 1;
      else result.skipped += 1;
    };

    for (const row of rows) {
      if (!row.booking_id) {
        await finish(row.id, 'FAILED', 'Job de notificação sem agendamento associado.');
        continue;
      }
      if (!isJobTemplateName(row.template)) {
        await finish(row.id, 'FAILED', `Template não registrado para jobs: ${row.template}`);
        continue;
      }

      const booking = await tx.booking.findFirst({
        where: { id: row.booking_id, tenantId },
      });
      if (!booking) {
        await finish(row.id, 'FAILED', 'Agendamento do job não encontrado neste tenant.');
        continue;
      }

      if (booking.status === 'CANCELLED' || booking.status === 'NO_SHOW') {
        await finish(row.id, 'CANCELED', `Agendamento ${booking.status}; lembrete cancelado.`);
        continue;
      }
      if (booking.status === 'COMPLETED') {
        await finish(row.id, 'SKIPPED', 'Agendamento já concluído; lembrete tardio descartado.');
        continue;
      }

      // Janela de tolerância: um job tarde demais, ou cujo atendimento já
      // começou, não é enviado. Sem isso um deploy de fim de semana despejaria
      // lembretes de agendamentos já passados.
      const deliverableUntil = Math.min(
        booking.startsAt.getTime(),
        row.scheduled_for.getTime() + toleranceMs,
      );
      if (now.getTime() > deliverableUntil) {
        await finish(row.id, 'SKIPPED', 'Janela de tolerância vencida.');
        continue;
      }

      const delivery = await resolveDelivery(tx, tenantId, booking, row.template);
      if (!delivery) {
        await finish(row.id, 'SKIPPED', 'Destinatário do template indisponível ou fora de E.164.');
        continue;
      }

      result.jobs.push({
        id: row.id,
        tenantId,
        bookingId: booking.id,
        template: row.template,
        attempts: row.attempts,
        scheduledFor: row.scheduled_for,
        delivery,
      });
    }

    return result;
  });
}

async function markJobSent(
  tenantId: string,
  jobId: string,
  providerMessageId: string,
  now: Date,
): Promise<void> {
  await forTenant(tenantId, (tx) =>
    tx.notificationJob.update({
      where: { id: jobId },
      data: {
        status: 'SENT',
        sentAt: now,
        providerMessageId,
        lockedAt: null,
        lastError: null,
      },
    }),
  );
}

async function markJobRetryOrFail(
  tenantId: string,
  job: ClaimedNotificationJob,
  now: Date,
  error: unknown,
): Promise<'retrying' | 'failed'> {
  const message = error instanceof Error ? error.message : String(error);
  const final = job.attempts >= MAX_JOB_ATTEMPTS;
  const truncated = message.slice(0, 500);

  await forTenant(tenantId, (tx) =>
    tx.notificationJob.update({
      where: { id: job.id },
      data: final
        ? { status: 'FAILED', lockedAt: null, lastError: truncated }
        : {
            status: 'PENDING',
            lockedAt: null,
            lastError: truncated,
            scheduledFor: new Date(now.getTime() + notificationBackoffMs(job.attempts)),
          },
    }),
  );

  return final ? 'failed' : 'retrying';
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface RunNotificationJobsOptions {
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
  /** Lote por tenant. */
  limit?: number;
  /** Injetável para teste; padrão: todos os tenants ativos. */
  tenantIds?: string[];
  /** Injetável para teste; padrão: a factory de provider por env. */
  provider?: WhatsAppProvider;
  /** Janela em que um job atrasado ainda vale a pena. */
  toleranceMs?: number;
  /** Tempo após o qual um job em `SENDING` é considerado órfão. */
  lockTimeoutMs?: number;
}

export interface NotificationRunSummary {
  tenants: number;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  canceled: number;
}

/**
 * Varre todos os tenants e processa os jobs vencidos. É o corpo do cron
 * `/api/cron/send-notifications`.
 *
 * A enumeração passa por `listAllTenantIds()` — o ponto único de travessia para
 * trabalho periódico (`lib/tenant/context.ts`). Cada tenant é processado na
 * própria transação escopada: um job jamais enxerga dado de outro tenant, e uma
 * falha num tenant não derruba os demais.
 */
export async function runNotificationJobs(
  options: RunNotificationJobsOptions = {},
): Promise<NotificationRunSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? JOB_BATCH_SIZE;
  const toleranceMs = options.toleranceMs ?? JOB_TOLERANCE_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? JOB_LOCK_TIMEOUT_MS;
  const provider = options.provider ?? getWhatsAppProvider();
  const tenantIds = options.tenantIds ?? (await listAllTenantIds());

  const summary: NotificationRunSummary = {
    tenants: tenantIds.length,
    claimed: 0,
    sent: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
    canceled: 0,
  };

  for (const tenantId of tenantIds) {
    let claim: ClaimResult;
    try {
      claim = await claimDueJobsForTenant(tenantId, now, limit, lockTimeoutMs, toleranceMs);
    } catch (error) {
      console.error(`[messaging:jobs] claim falhou para o tenant ${tenantId}; seguindo.`, error);
      continue;
    }
    summary.failed += claim.failed;
    summary.skipped += claim.skipped;
    summary.canceled += claim.canceled;

    for (const job of claim.jobs) {
      summary.claimed += 1;
      try {
        const { providerMessageId } = await provider.sendTemplate(
          job.delivery.to,
          job.template,
          job.delivery.vars,
        );
        await markJobSent(job.tenantId, job.id, providerMessageId, now);
        summary.sent += 1;
      } catch (error) {
        console.error(
          `[messaging:jobs] envio falhou (job ${job.id}, template ${job.template}); retry/backoff.`,
          error,
        );
        const outcome = await markJobRetryOrFail(job.tenantId, job, now, error);
        if (outcome === 'failed') summary.failed += 1;
        else summary.retrying += 1;
      }
    }
  }

  return summary;
}
