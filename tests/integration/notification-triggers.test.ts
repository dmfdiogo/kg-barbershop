// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatInTimeZone } from 'date-fns-tz';
import { cancelBooking } from '@/lib/booking/cancel';
import { confirmBooking, emitBookingEvent } from '@/lib/booking/confirm';
import { runNotificationJobs } from '@/lib/messaging/jobs';
import { clearOutboxMessages, listOutboxMessages } from '@/lib/messaging/outbox';
import {
  D1_OFFSET_MS,
  H2_OFFSET_MS,
  confirmBookingAttendance,
  scheduleBookingCancelledNotifications,
  scheduleBookingConfirmedNotifications,
  scheduleBookingRescheduledNotifications,
} from '@/lib/messaging/triggers';
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
 * Gatilhos de notificação (tarefa F6.1).
 *
 * O que se prova: agendar cria os jobs no fuso do tenant; avançar o relógio
 * produz D-1 e H-2 na ordem certa; criado tarde demais não gera lembrete;
 * silêncio noturno segura a madrugada; cancelar cancela os pendentes com aviso
 * às duas pontas; e nenhum tenant envia com dado do outro.
 */

interface RecordedCall {
  to: E164;
  template: TemplateName;
  vars: Record<string, string>;
}

class RecordingWhatsApp implements WhatsAppProvider {
  readonly calls: RecordedCall[] = [];

  async sendOtp(): Promise<{ providerMessageId: string }> {
    throw new Error('OTP não é usado por jobs.');
  }

  async sendTemplate(
    to: E164,
    template: TemplateName,
    vars: Record<string, string>,
  ): Promise<{ providerMessageId: string }> {
    this.calls.push({ to, template, vars });
    return { providerMessageId: `test.${this.calls.length}` };
  }
}

const TZ = 'America/Sao_Paulo';

function local(date: Date): string {
  return formatInTimeZone(date, TZ, 'yyyy-MM-dd HH:mm');
}

describe('gatilhos de notificação (F6.1)', () => {
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
  });

  afterAll(async () => {
    if (admin) await admin.disconnect();
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  async function setStartsAt(fixture: TenantFixture, startsAt: Date): Promise<void> {
    await admin.asPlatformAdmin((tx) =>
      tx.booking.update({
        where: { id: fixture.bookingId },
        data: {
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
        },
      }),
    );
  }

  async function jobsFor(fixture: TenantFixture) {
    return admin.asPlatformAdmin((tx) =>
      tx.notificationJob.findMany({
        where: { tenantId: fixture.tenantId, bookingId: fixture.bookingId },
        orderBy: { template: 'asc' },
      }),
    );
  }

  async function job(template: string, fixture: TenantFixture) {
    return admin.asPlatformAdmin((tx) =>
      tx.notificationJob.findFirst({
        where: { tenantId: fixture.tenantId, bookingId: fixture.bookingId, template },
      }),
    );
  }

  async function phoneOfMember(memberId: string): Promise<string> {
    return admin.asPlatformAdmin(async (tx) => {
      const member = await tx.tenantMember.findUnique({
        where: { id: memberId },
        select: { userId: true },
      });
      const user = await tx.user.findUnique({
        where: { id: member!.userId },
        select: { phone: true },
      });
      return user!.phone;
    });
  }

  it('agendar cria confirmação imediata e lembretes no instante correto do fuso', async () => {
    const fixture = await makeTenant('trig-confirm');
    const startsAt = new Date('2026-11-03T13:00:00.000Z'); // 10:00 local
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    const result = await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const byTemplate = new Map(result.enqueued.map((job) => [job.template, job.scheduledFor]));
    expect(byTemplate.get('booking_confirmation')?.getTime()).toBe(now.getTime());
    expect(byTemplate.get('booking_created_staff')?.getTime()).toBe(now.getTime());
    expect(byTemplate.get('booking_reminder_d1')?.getTime()).toBe(startsAt.getTime() - D1_OFFSET_MS);
    expect(byTemplate.get('booking_reminder_h2')?.getTime()).toBe(startsAt.getTime() - H2_OFFSET_MS);
    expect(local(byTemplate.get('booking_reminder_d1')!)).toBe('2026-11-02 10:00');
    expect(local(byTemplate.get('booking_reminder_h2')!)).toBe('2026-11-03 08:00');
  });

  it('avançar o relógio envia D-1 e depois H-2, e o cron repetido não duplica', async () => {
    const fixture = await makeTenant('trig-clock');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const provider = new RecordingWhatsApp();
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId], now });

    const atD1 = new Date(startsAt.getTime() - D1_OFFSET_MS);
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId], now: atD1 });
    // Antes do H-2, o lembrete de 2h não está vencido.
    expect(provider.calls.filter((call) => call.template === 'booking_reminder_h2')).toHaveLength(0);

    const atH2 = new Date(startsAt.getTime() - H2_OFFSET_MS);
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId], now: atH2 });

    const templates = provider.calls.map((call) => call.template);
    expect(templates).toContain('booking_reminder_d1');
    expect(templates).toContain('booking_reminder_h2');
    expect(templates.indexOf('booking_reminder_d1')).toBeLessThan(
      templates.indexOf('booking_reminder_h2'),
    );

    // Cron sobreposto depois não reenvia.
    const before = provider.calls.length;
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId], now: atH2 });
    expect(provider.calls.length).toBe(before);
  });

  it('criado com menos de 24h não gera D-1; com menos de 2h não gera H-2', async () => {
    const fixture = await makeTenant('trig-late');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);

    const under24h = new Date(startsAt.getTime() - 3 * 3_600_000);
    const first = await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now: under24h,
    });
    const firstTemplates = first.enqueued.map((job) => job.template);
    expect(firstTemplates).toContain('booking_confirmation');
    expect(firstTemplates).not.toContain('booking_reminder_d1');
    expect(firstTemplates).toContain('booking_reminder_h2');

    const other = await makeTenant('trig-late2');
    await setStartsAt(other, startsAt);
    const under2h = new Date(startsAt.getTime() - 1 * 3_600_000);
    const second = await scheduleBookingConfirmedNotifications({
      tenantId: other.tenantId,
      bookingId: other.bookingId,
      now: under2h,
    });
    const secondTemplates = second.enqueued.map((job) => job.template);
    expect(secondTemplates).not.toContain('booking_reminder_d1');
    expect(secondTemplates).not.toContain('booking_reminder_h2');
  });

  it('silêncio noturno: H-2 das 4h para um atendimento às 6h não é agendado', async () => {
    const fixture = await makeTenant('trig-quiet');
    const startsAt = new Date('2026-11-03T09:00:00.000Z'); // 06:00 local
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    const result = await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const templates = result.enqueued.map((job) => job.template);
    expect(templates).not.toContain('booking_reminder_h2');
    expect(result.skipped.map((job) => job.template)).toContain('booking_reminder_h2');
    const d1 = result.enqueued.find((job) => job.template === 'booking_reminder_d1');
    expect(local(d1!.scheduledFor)).toBe('2026-11-02 08:00');
  });

  it('cancelar agendamento cancela lembretes pendentes e avisa cliente e profissional', async () => {
    const fixture = await makeTenant('trig-cancel');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    await cancelBooking({ tenantId: fixture.tenantId, bookingId: fixture.bookingId, bypassWindow: true });

    const d1 = await job('booking_reminder_d1', fixture);
    const h2 = await job('booking_reminder_h2', fixture);
    expect(d1?.status).toBe('CANCELED');
    expect(h2?.status).toBe('CANCELED');

    const pending = (await jobsFor(fixture)).filter((row) => row.status === 'PENDING');
    expect(pending.map((row) => row.template).sort()).toEqual([
      'booking_cancelled_customer',
      'booking_cancelled_staff',
    ]);
  });

  it('o cron entrega os avisos de cancelamento e nenhum lembrete obsoleto', async () => {
    const fixture = await makeTenant('trig-cancel-send');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const created = new Date(startsAt.getTime() - 48 * 3_600_000);
    await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now: created,
    });

    // Cancelamento com `now` no futuro: o cron global de outros testes roda no
    // agora real e não alcança estes jobs — o teste fica determinístico.
    const cancelledAt = new Date(startsAt.getTime() - 24 * 3_600_000);
    await scheduleBookingCancelledNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now: cancelledAt,
    });

    const provider = new RecordingWhatsApp();
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId], now: cancelledAt });

    expect(provider.calls.map((call) => call.template).sort()).toEqual([
      'booking_cancelled_customer',
      'booking_cancelled_staff',
    ]);
  });

  it('remarcação avisa as duas pontas e reagenda os lembretes do novo horário', async () => {
    const fixture = await makeTenant('trig-resched');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    const result = await scheduleBookingRescheduledNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const templates = result.enqueued.map((job) => job.template);
    expect(templates).toEqual(
      expect.arrayContaining([
        'booking_rescheduled_customer',
        'booking_rescheduled_staff',
        'booking_reminder_d1',
        'booking_reminder_h2',
      ]),
    );
  });

  it('o post-commit da confirmação descobre o handler e cria os jobs', async () => {
    const fixture = await makeTenant('trig-participant');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);

    await confirmBooking({ tenantId: fixture.tenantId, bookingId: fixture.bookingId });

    const templates = (await jobsFor(fixture)).map((row) => row.template);
    expect(templates).toEqual(
      expect.arrayContaining([
        'booking_confirmation',
        'booking_created_staff',
        'booking_reminder_d1',
        'booking_reminder_h2',
      ]),
    );
  });

  it('o post-commit da remarcação descobre o handler pelo emitBookingEvent', async () => {
    const fixture = await makeTenant('trig-emit');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);

    await emitBookingEvent({
      type: 'BookingRescheduled',
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      occurredAt: new Date(startsAt.getTime() - 48 * 3_600_000),
      customerId: fixture.customerMemberId,
      serviceId: fixture.serviceId,
      previousStaffId: fixture.staffId,
      previousStartsAt: new Date(startsAt.getTime() - 3 * 3_600_000),
      previousEndsAt: new Date(startsAt.getTime() - 2 * 3_600_000),
      staffId: fixture.staffId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    });

    const templates = (await jobsFor(fixture)).map((row) => row.template);
    expect(templates).toContain('booking_rescheduled_customer');
    expect(templates).toContain('booking_rescheduled_staff');
  });

  it('confirmar presença cancela só os lembretes e é idempotente', async () => {
    const fixture = await makeTenant('trig-attendance');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const first = await confirmBookingAttendance({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
    });
    expect(first.alreadyResponded).toBe(false);
    expect(first.canceledReminders).toBe(2);
    expect((await job('booking_reminder_d1', fixture))?.status).toBe('CANCELED');
    expect((await job('booking_reminder_h2', fixture))?.status).toBe('CANCELED');
    // A confirmação imediata e o aviso ao profissional continuam pendentes.
    expect((await job('booking_confirmation', fixture))?.status).toBe('PENDING');
    expect((await job('booking_created_staff', fixture))?.status).toBe('PENDING');

    const second = await confirmBookingAttendance({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
    });
    expect(second.alreadyResponded).toBe(true);
    expect(second.canceledReminders).toBe(0);
  });

  it('nenhuma mensagem de um tenant sai com destinatário de outro', async () => {
    const tenantA = await makeTenant('trig-iso-a');
    const tenantB = await makeTenant('trig-iso-b');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(tenantA, startsAt);
    await setStartsAt(tenantB, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);

    await scheduleBookingConfirmedNotifications({
      tenantId: tenantA.tenantId,
      bookingId: tenantA.bookingId,
      now,
    });
    await scheduleBookingConfirmedNotifications({
      tenantId: tenantB.tenantId,
      bookingId: tenantB.bookingId,
      now,
    });

    const provider = new RecordingWhatsApp();
    await runNotificationJobs({ provider, tenantIds: [tenantA.tenantId], now });

    expect(provider.calls.length).toBeGreaterThan(0);
    const allowed = new Set([
      await phoneOfMember(tenantA.customerMemberId),
      await phoneOfMember(tenantA.staffMemberId),
    ]);
    const forbidden = new Set([
      await phoneOfMember(tenantB.customerMemberId),
      await phoneOfMember(tenantB.staffMemberId),
    ]);
    for (const call of provider.calls) {
      expect(allowed.has(call.to)).toBe(true);
      expect(forbidden.has(call.to)).toBe(false);
    }

    const pendingB = await admin.asPlatformAdmin((tx) =>
      tx.notificationJob.count({
        where: { tenantId: tenantB.tenantId, status: 'PENDING' },
      }),
    );
    expect(pendingB).toBeGreaterThan(0);
  });

  it('todos os templates de gatilho passam pelo mock que recusa template não registrado', async () => {
    const fixture = await makeTenant('trig-mock');
    const startsAt = new Date('2026-11-03T13:00:00.000Z');
    await setStartsAt(fixture, startsAt);
    const now = new Date(startsAt.getTime() - 48 * 3_600_000);
    clearOutboxMessages();

    await scheduleBookingConfirmedNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });
    await scheduleBookingCancelledNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });
    await scheduleBookingRescheduledNotifications({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      now,
    });

    const summary = await runNotificationJobs({
      provider: new MockWhatsAppProvider(),
      tenantIds: [fixture.tenantId],
      now,
    });
    expect(summary.failed).toBe(0);
    expect(listOutboxMessages().length).toBeGreaterThan(0);
  });
});
