// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { enqueueNotificationJob, runNotificationJobs } from '@/lib/messaging/jobs';
import {
  clearMessagingOptOut,
  getMessagingPreference,
  isTenantMemberOptedOut,
  listMessagingOverview,
  recordConsent,
  setMessagingOptOut,
} from '@/lib/messaging/preferences';
import type { JobTemplateName, TemplateName } from '@/lib/messaging/templates';
import type { E164, WhatsAppProvider } from '@/lib/messaging/types';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Opt-out, consentimento e log de entrega (tarefa F6.2), com Postgres real e a
 * role SEM superuser para que a RLS valha:
 *
 *   - consentimento guarda data e origem;
 *   - opt-out barra lembrete D-1/H-2 mas preserva a confirmação (transacional);
 *   - remover o opt-out é consentir de novo e volta a enviar;
 *   - falha tem motivo no log (é o que responde "não recebi");
 *   - preferência de um tenant não vaza para outro.
 */

class RecordingWhatsApp implements WhatsAppProvider {
  readonly calls: Array<{ to: E164; template: TemplateName; vars: Record<string, string> }> = [];
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

describe('preferências de mensageria e opt-out', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenantId = createdTenants.pop();
      if (tenantId) await deleteTenant(admin, tenantId);
    }
  });

  afterAll(async () => {
    if (admin) {
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  async function customerUserId(fixture: TenantFixture): Promise<string> {
    const member = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: fixture.customerMemberId },
        select: { userId: true },
      }),
    );
    return member!.userId;
  }

  function schedule(fixture: TenantFixture, template: JobTemplateName) {
    return enqueueNotificationJob({
      tenantId: fixture.tenantId,
      bookingId: fixture.bookingId,
      template,
      scheduledFor: new Date(Date.now() - MINUTE),
    });
  }

  it('registra consentimento com data e origem', async () => {
    const fixture = await makeTenant('pref-consent');
    const userId = await customerUserId(fixture);
    const at = new Date('2026-01-02T03:04:05.000Z');

    const record = await scoped.forTenant(fixture.tenantId, (tx) =>
      recordConsent(tx, { tenantId: fixture.tenantId, userId, source: 'portal', at }),
    );

    expect(record.consentAt?.toISOString()).toBe(at.toISOString());
    expect(record.consentSource).toBe('portal');
    expect(record.optedOutAt).toBeNull();
  });

  it('opt-out bloqueia lembrete e preserva a confirmação transacional', async () => {
    const fixture = await makeTenant('pref-optout');
    const userId = await customerUserId(fixture);
    await scoped.forTenant(fixture.tenantId, (tx) =>
      setMessagingOptOut(tx, { tenantId: fixture.tenantId, userId }),
    );

    expect(
      await scoped.forTenant(fixture.tenantId, (tx) =>
        isTenantMemberOptedOut(tx, fixture.tenantId, fixture.customerMemberId),
      ),
    ).toBe(true);

    await schedule(fixture, 'booking_reminder_d1');
    await schedule(fixture, 'booking_confirmation');

    const provider = new RecordingWhatsApp();
    const summary = await runNotificationJobs({ provider, tenantIds: [fixture.tenantId] });

    expect(provider.calls.map((call) => call.template)).toEqual(['booking_confirmation']);
    expect(summary.sent).toBe(1);
    expect(summary.skipped).toBe(1);

    const overview = await scoped.forTenant(fixture.tenantId, (tx) =>
      listMessagingOverview(tx, fixture.tenantId),
    );
    const skipped = overview.deliveries.find(
      (delivery) => delivery.template === 'booking_reminder_d1',
    );
    expect(skipped?.status).toBe('SKIPPED');
    expect(skipped?.lastError).toMatch(/opt-out/i);
  });

  it('remover o opt-out grava novo consentimento e volta a enviar', async () => {
    const fixture = await makeTenant('pref-resume');
    const userId = await customerUserId(fixture);
    await scoped.forTenant(fixture.tenantId, (tx) =>
      setMessagingOptOut(tx, { tenantId: fixture.tenantId, userId }),
    );

    const at = new Date('2026-06-07T08:09:10.000Z');
    await scoped.forTenant(fixture.tenantId, (tx) =>
      clearMessagingOptOut(tx, { tenantId: fixture.tenantId, userId, source: 'painel', at }),
    );

    const pref = await scoped.forTenant(fixture.tenantId, (tx) =>
      getMessagingPreference(tx, fixture.tenantId, userId),
    );
    expect(pref?.optedOutAt).toBeNull();
    expect(pref?.consentSource).toBe('painel');

    await schedule(fixture, 'booking_reminder_d1');
    const provider = new RecordingWhatsApp();
    const summary = await runNotificationJobs({ provider, tenantIds: [fixture.tenantId] });
    expect(summary.sent).toBe(1);
    expect(provider.calls[0]?.template).toBe('booking_reminder_d1');
  });

  it('o log mostra a falha com o motivo', async () => {
    const fixture = await makeTenant('pref-log');
    await schedule(fixture, 'booking_confirmation');

    const provider = new RecordingWhatsApp();
    provider.failure = new Error('provider fora do ar');
    await runNotificationJobs({ provider, tenantIds: [fixture.tenantId] });

    const overview = await scoped.forTenant(fixture.tenantId, (tx) =>
      listMessagingOverview(tx, fixture.tenantId),
    );
    const row = overview.deliveries.find(
      (delivery) => delivery.template === 'booking_confirmation',
    );
    expect(row?.lastError).toContain('provider fora do ar');
    expect(overview.stats.failed + overview.stats.pending).toBeGreaterThan(0);
  });

  it('preferência de um tenant não vaza para o outro', async () => {
    const a = await makeTenant('pref-iso-a');
    const b = await makeTenant('pref-iso-b');
    const userA = await customerUserId(a);

    await scoped.forTenant(a.tenantId, (tx) =>
      setMessagingOptOut(tx, { tenantId: a.tenantId, userId: userA }),
    );

    const overviewB = await scoped.forTenant(b.tenantId, (tx) =>
      listMessagingOverview(tx, b.tenantId),
    );
    expect(overviewB.customers.every((customer) => !customer.optedOut)).toBe(true);
  });
});
