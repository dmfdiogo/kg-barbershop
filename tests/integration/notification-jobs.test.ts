// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/send-notifications/route';
import {
  MAX_JOB_ATTEMPTS,
  cancelPendingNotificationJobs,
  enqueueNotificationJob,
  runNotificationJobs,
} from '@/lib/messaging/jobs';
import { clearOutboxMessages, listOutboxMessages } from '@/lib/messaging/outbox';
import { MockWhatsAppProvider } from '@/lib/messaging/mock';
import type { TemplateName } from '@/lib/messaging/templates';
import type { E164, WhatsAppProvider } from '@/lib/messaging/types';
import type { TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Runner de lembretes persistidos (tarefa F6.0).
 *
 * O que se prova aqui: cron sobreposto não envia duas vezes, o claim
 * `UPDATE ... RETURNING` + `FOR UPDATE SKIP LOCKED` funciona, retry tem backoff
 * e teto, jobs de agendamento cancelado não saem e um tenant nunca vê job do
 * outro.
 */

interface RecordedCall {
  to: E164;
  template: TemplateName;
  vars: Record<string, string>;
}

class RecordingWhatsApp implements WhatsAppProvider {
  readonly calls: RecordedCall[] = [];
  failure: Error | null = null;

  async sendOtp(): Promise<{ providerMessageId: string }> {
    throw new Error('OTP não é usado por jobs.');
  }

  async sendTemplate(
    to: E164,
    template: TemplateName,
    vars: Record<string, string>,
  ): Promise<{ providerMessageId: string }> {
    this.calls.push({ to, template, vars });
    if (this.failure) throw this.failure;
    return { providerMessageId: `test.${this.calls.length}` };
  }
}

const MINUTE = 60_000;

describe('runner de NotificationJob', () => {
  let admin: TenantDb;
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
  }, 180_000);

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenantId = createdTenants.pop();
      if (tenantId) await deleteTenant(admin, tenantId);
    }
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (admin) await admin.disconnect();
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  function run(
    fixture: TenantFixture,
    provider: WhatsAppProvider,
    overrides: { now?: Date; lockTimeoutMs?: number } = {},
  ) {
    return runNotificationJobs({
      provider,
      tenantIds: [fixture.tenantId],
      ...overrides,
    });
  }

  async function jobRow(id: string) {
    return admin.asPlatformAdmin((tx) =>
      tx.notificationJob.findUnique({ where: { id } }),
    );
  }

  async function customerPhone(fixture: TenantFixture): Promise<string> {
    return admin.asPlatformAdmin(async (tx) => {
      const member = await tx.tenantMember.findUnique({
        where: { id: fixture.customerMemberId },
        select: { userId: true },
      });
      const user = await tx.user.findUnique({
        where: { id: member!.userId },
        select: { phone: true },
      });
      return user!.phone;
    });
  }

  async function schedule(
    fixture: TenantFixture,
    template: Parameters<typeof enqueueNotificationJob>[0]['template'],
    scheduledFor = new Date(Date.now() - MINUTE),
  ) {
    return enqueueNotificationJob({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      template,
      scheduledFor,
    });
  }

  it('envia um job vencido uma única vez e registra providerMessageId', async () => {
    const fixture = await makeTenant('notif-once');
    const provider = new RecordingWhatsApp();
    const { id } = await schedule(fixture, 'booking_confirmation');

    const first = await run(fixture, provider);
    expect(first.claimed).toBe(1);
    expect(first.sent).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.to).toBe(await customerPhone(fixture));

    const row = await jobRow(id);
    expect(row).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(row?.providerMessageId).toBe('test.1');
    expect(row?.sentAt).not.toBeNull();

    const second = await run(fixture, provider);
    expect(second.claimed).toBe(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('cron sobreposto não envia duas vezes', async () => {
    const fixture = await makeTenant('notif-race');
    const provider = new RecordingWhatsApp();
    await schedule(fixture, 'booking_reminder_h2');

    const [a, b] = await Promise.all([run(fixture, provider), run(fixture, provider)]);

    expect(provider.calls).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.claimed + b.claimed).toBe(1);
  });

  it('enfileiramento é idempotente por (agendamento, template)', async () => {
    const fixture = await makeTenant('notif-dedupe');
    const first = await schedule(fixture, 'booking_reminder_d1');
    const second = await schedule(fixture, 'booking_reminder_d1');

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.id).toBe(first.id);

    const count = await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.count({
        where: { tenantId: fixture.tenantId, template: 'booking_reminder_d1' },
      }),
    );
    expect(count).toBe(1);
  });

  it('falha volta para PENDING com backoff e lastError', async () => {
    const fixture = await makeTenant('notif-retry');
    const provider = new RecordingWhatsApp();
    provider.failure = new Error('provider fora do ar');
    const { id } = await schedule(fixture, 'booking_confirmation');

    const summary = await run(fixture, provider);
    expect(summary.retrying).toBe(1);
    expect(summary.failed).toBe(0);

    const row = await jobRow(id);
    expect(row?.status).toBe('PENDING');
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain('provider fora do ar');
    expect(row!.scheduledFor.getTime()).toBeGreaterThan(Date.now());

    // Ainda não venceu: a próxima passada não tenta de novo.
    const again = await run(fixture, provider);
    expect(again.claimed).toBe(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('esgota as tentativas e termina em FAILED', async () => {
    const fixture = await makeTenant('notif-fail');
    const provider = new RecordingWhatsApp();
    provider.failure = new Error('falha definitiva');
    const { id } = await schedule(fixture, 'booking_confirmation');

    await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.update({
        where: { id },
        data: { attempts: MAX_JOB_ATTEMPTS - 1 },
      }),
    );

    const summary = await run(fixture, provider);
    expect(summary.failed).toBe(1);

    const row = await jobRow(id);
    expect(row?.status).toBe('FAILED');
    expect(row?.attempts).toBe(MAX_JOB_ATTEMPTS);
  });

  it('recolhe job órfão preso em SENDING', async () => {
    const fixture = await makeTenant('notif-stale');
    const provider = new RecordingWhatsApp();
    const { id } = await schedule(fixture, 'booking_confirmation');

    await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.update({
        where: { id },
        data: { status: 'SENDING', lockedAt: new Date(Date.now() - 30 * MINUTE), attempts: 1 },
      }),
    );

    const summary = await run(fixture, provider, { lockTimeoutMs: 5 * MINUTE });
    expect(summary.sent).toBe(1);
    expect((await jobRow(id))?.status).toBe('SENT');
  });

  it('não envia lembrete de agendamento cancelado', async () => {
    const fixture = await makeTenant('notif-cancel');
    const provider = new RecordingWhatsApp();
    const { id } = await schedule(fixture, 'booking_reminder_d1');

    await admin.asPlatformAdmin((tx) =>
      tx.booking.update({ where: { id: fixture.bookingId }, data: { status: 'CANCELLED' } }),
    );

    const summary = await run(fixture, provider);
    expect(summary.canceled).toBe(1);
    expect(provider.calls).toHaveLength(0);
    expect((await jobRow(id))?.status).toBe('CANCELED');
  });

  it('cancelPendingNotificationJobs cancela só o que está pendente', async () => {
    const fixture = await makeTenant('notif-cancel-pending');
    await schedule(fixture, 'booking_reminder_d1');
    await schedule(fixture, 'booking_reminder_h2');

    const canceled = await cancelPendingNotificationJobs(fixture.tenantId, fixture.bookingId);
    expect(canceled).toBe(2);

    const pending = await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.count({
        where: { tenantId: fixture.tenantId, status: 'PENDING' },
      }),
    );
    expect(pending).toBe(0);
  });

  it('template não registrado vira FAILED e não é enviado', async () => {
    const fixture = await makeTenant('notif-bogus');
    const provider = new RecordingWhatsApp();

    const created = await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.create({
        data: {
          tenantId: fixture.tenantId,
          bookingId: fixture.bookingId,
          template: 'template_inventado',
          scheduledFor: new Date(Date.now() - MINUTE),
        },
        select: { id: true },
      }),
    );

    const summary = await run(fixture, provider);
    expect(summary.failed).toBe(1);
    expect(provider.calls).toHaveLength(0);
    expect((await jobRow(created.id))?.status).toBe('FAILED');
  });

  it('processa somente o tenant alvo (isolamento)', async () => {
    const tenantA = await makeTenant('notif-iso-a');
    const tenantB = await makeTenant('notif-iso-b');
    const provider = new RecordingWhatsApp();

    await schedule(tenantA, 'booking_confirmation');
    await schedule(tenantB, 'booking_confirmation');

    const onlyA = await run(tenantA, provider);
    expect(onlyA.sent).toBe(1);
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.to).toBe(await customerPhone(tenantA));

    const pendingB = await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.count({
        where: { tenantId: tenantB.tenantId, status: 'PENDING' },
      }),
    );
    expect(pendingB).toBe(1);

    const onlyB = await run(tenantB, provider);
    expect(onlyB.sent).toBe(1);
    expect(provider.calls[1]?.to).toBe(await customerPhone(tenantB));
  });

  it('resolve todas as variáveis declaradas contra o mock (que recusa template/template vars)', async () => {
    const fixture = await makeTenant('notif-mock');
    const provider = new MockWhatsAppProvider();
    clearOutboxMessages();

    const templates = [
      'booking_confirmation',
      'booking_reminder_d1',
      'booking_reminder_h2',
      'booking_cancelled_customer',
      'booking_cancelled_staff',
      'booking_rescheduled_customer',
      'booking_rescheduled_staff',
      'booking_created_staff',
    ] as const;

    for (const template of templates) {
      await schedule(fixture, template);
    }

    const summary = await run(fixture, provider);
    expect(summary.sent).toBe(templates.length);
    expect(summary.failed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(listOutboxMessages()).toHaveLength(templates.length);
  });
});

describe('GET /api/cron/send-notifications', () => {
  const URL = 'http://localhost/api/cron/send-notifications';
  const CRON_SECRET = 'cron-secret-de-teste';

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sem CRON_SECRET configurado falha fechado com 503', async () => {
    vi.stubEnv('CRON_SECRET', '');
    const response = await GET(new Request(URL));
    expect(response.status).toBe(503);
  });

  it('com credencial errada responde 401', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    const response = await GET(new Request(URL, { headers: { authorization: 'Bearer nope' } }));
    expect(response.status).toBe(401);
  });

  it('autorizado responde 200 com o resumo da execução', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    const response = await GET(
      new Request(URL, { headers: { authorization: `Bearer ${CRON_SECRET}` } }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; claimed: number };
    expect(body.ok).toBe(true);
    expect(typeof body.claimed).toBe('number');
  });
});
