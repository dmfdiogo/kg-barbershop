import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBillingProvider } from '@/lib/billing/mock';
import { createMockBillingStore, type MockBillingStore } from '@/lib/billing/mock-store';
import {
  cancelSubscription,
  changePlan,
  getLocalSubscription,
  subscribe,
  SubscriptionSuspendedError,
  updatePaymentMethod,
  type BillingCardInput,
} from '@/lib/billing/subscription';
import { createHold } from '@/lib/booking/hold';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import type { WebhookDeliveryRequest } from '@/lib/billing/webhook';
import {
  parseBillingWebhookEvent,
  processBillingWebhook,
} from '@/app/api/webhooks/billing/processor';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Ciclo de cobrança B2B completo (tarefa F7.2), com Postgres real e o mock
 * entregando webhook de verdade contra o núcleo persistente.
 *
 * O que se prova:
 *   - assinar, trocar de plano com proração, atualizar cartão e cancelar;
 *   - inadimplir → suspensão graciosa → reativar;
 *   - a suspensão bloqueia só o NOVO e preserva o existente;
 *   - webhook reentregue responde 200 sem reprocessar nem renovar duas vezes;
 *   - uma assinatura não vaza para outro tenant.
 */

const SECRET = 'integration-billing-secret';

function card(number = '4111111111111111'): BillingCardInput {
  return {
    holderName: 'Dono do Salão',
    number,
    expiryMonth: '12',
    expiryYear: '2030',
    ccv: '123',
  };
}

function makeProvider(store: MockBillingStore, deliveries: WebhookDeliveryRequest[]) {
  return new MockBillingProvider({
    store,
    transport: {
      async deliver(request) {
        deliveries.push(request);
        const event = parseBillingWebhookEvent(request.body);
        if (!event) return { ok: false, status: 400 };
        const result = await processBillingWebhook(event, request.body);
        return { ok: result.status === 200, status: result.status };
      },
    },
    webhookUrl: 'http://127.0.0.1:9/api/webhooks/billing',
    webhookSecret: SECRET,
  });
}

describe('billing: ciclo de cobrança', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let store: MockBillingStore;
  let provider: MockBillingProvider;
  let deliveries: WebhookDeliveryRequest[];
  const tenants: string[] = [];
  let slotSeed = 0;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
    // Um único store para o arquivo inteiro: os ids do mock são sequenciais e,
    // reiniciando por teste, colidiriam com os `PlatformSub` ainda no banco e a
    // resolução do webhook acharia o tenant errado. Em produção o id do provedor
    // é único; aqui a unicidade é garantida não resetando o store.
    store = createMockBillingStore();
    deliveries = [];
    provider = makeProvider(store, deliveries);
  }, 180_000);

  afterAll(async () => {
    const eventIds = deliveries
      .map((delivery) => parseBillingWebhookEvent(delivery.body)?.eventId)
      .filter((eventId): eventId is string => Boolean(eventId));
    if (eventIds.length > 0) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }),
      );
    }
    for (const tenantId of tenants) {
      await deleteTenant(admin, tenantId);
    }
    await scoped?.disconnect();
    await admin?.disconnect();
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const tenant = await createTenantFixture(admin, prefix);
    tenants.push(tenant.tenantId);
    return tenant;
  }

  function slotAt(): Date {
    slotSeed += 1;
    return new Date(Date.UTC(2027, 0, 1 + slotSeed, 9, 0, 0));
  }

  async function readSub(tenantId: string) {
    return getLocalSubscription(tenantId);
  }

  it('assinar → trocar → inadimplir → suspender → reativar', async () => {
    const tenant = await makeTenant('sub-cycle');

    const subscribed = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      card: card(),
      provider,
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;
    const subscriptionId = subscribed.providerSubscription.id;

    const afterSubscribe = await readSub(tenant.tenantId);
    expect(afterSubscribe).toMatchObject({ plan: 'SOLO', status: 'ACTIVE' });

    const upgraded = await changePlan({
      tenantId: tenant.tenantId,
      plan: 'EQUIPE',
      provider,
    });
    expect(upgraded.ok).toBe(true);
    const afterUpgrade = await readSub(tenant.tenantId);
    expect(afterUpgrade).toMatchObject({ plan: 'EQUIPE', status: 'ACTIVE' });
    expect((await provider.getSubscription(subscriptionId)).amountCents).toBe(7990);

    const failed = await provider.simulateInvoicePaymentFailed(subscriptionId);
    expect(failed.delivered).toBe(true);
    expect((await readSub(tenant.tenantId))?.status).toBe('PAST_DUE');

    // Suspensão graciosa: novo agendamento recusado, existente intacto.
    await expect(
      createHold({
        tenantId: tenant.tenantId,
        customerId: tenant.customerMemberId,
        staffId: tenant.staffId,
        serviceId: tenant.serviceId,
        startsAt: slotAt(),
        holdSessionId: 'cycle-suspended',
      }),
    ).rejects.toBeInstanceOf(SubscriptionSuspendedError);

    const paid = await provider.simulateInvoicePaid(subscriptionId);
    expect(paid.delivered).toBe(true);
    expect((await readSub(tenant.tenantId))?.status).toBe('ACTIVE');

    const hold = await createHold({
      tenantId: tenant.tenantId,
      customerId: tenant.customerMemberId,
      staffId: tenant.staffId,
      serviceId: tenant.serviceId,
      startsAt: slotAt(),
      holdSessionId: 'cycle-reactivated',
    });
    expect(hold.id).toBeTruthy();
  });

  it('a suspensão preserva dados e acesso ao que já existe', async () => {
    const tenant = await makeTenant('sub-preserve');
    const subscribed = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'EQUIPE',
      card: card(),
      provider,
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const existingId = tenant.bookingId;
    const before = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.count({ where: { tenantId: tenant.tenantId } }),
    );

    await provider.simulateInvoicePaymentFailed(subscribed.providerSubscription.id);

    const after = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.count({ where: { tenantId: tenant.tenantId } }),
    );
    expect(after).toBe(before);

    const preserved = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: existingId }, select: { id: true, status: true } }),
    );
    expect(preserved?.id).toBe(existingId);
    expect(preserved?.status).toBe('HOLD');
  });

  it('cancelar encerra a assinatura e bloqueia o novo', async () => {
    const tenant = await makeTenant('sub-cancel');
    const subscribed = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      card: card(),
      provider,
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const canceled = await cancelSubscription({ tenantId: tenant.tenantId, provider });
    expect(canceled.ok).toBe(true);
    expect((await readSub(tenant.tenantId))?.status).toBe('CANCELED');

    await expect(
      createHold({
        tenantId: tenant.tenantId,
        customerId: tenant.customerMemberId,
        staffId: tenant.staffId,
        serviceId: tenant.serviceId,
        startsAt: slotAt(),
        holdSessionId: 'canceled-blocked',
      }),
    ).rejects.toBeInstanceOf(SubscriptionSuspendedError);
  });

  it('atualizar o meio de pagamento não altera o estado da assinatura', async () => {
    const tenant = await makeTenant('sub-card');
    const subscribed = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'PRO',
      card: card(),
      provider,
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const updated = await updatePaymentMethod({
      tenantId: tenant.tenantId,
      card: card('5555555555554444'),
      provider,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.providerSubscription.id).toBe(subscribed.providerSubscription.id);
    }
    expect((await readSub(tenant.tenantId))?.status).toBe('ACTIVE');
  });

  it('assinar duas vezes não cria cobrança dupla', async () => {
    const tenant = await makeTenant('sub-double');
    const first = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      card: card(),
      provider,
    });
    expect(first.ok).toBe(true);

    const second = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      card: card(),
      provider,
    });
    expect(second).toMatchObject({ ok: false, code: 'SUBSCRIBER_ALREADY_EXISTS' });
  });

  it('webhook reentregue não renova nem credita duas vezes', async () => {
    const tenant = await makeTenant('sub-idem');
    const subscribed = await subscribe({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      card: card(),
      provider,
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    await provider.simulateInvoicePaid(subscribed.providerSubscription.id);
    const first = await readSub(tenant.tenantId);
    const eventId = parseBillingWebhookEvent(deliveries.at(-1)!.body)!.eventId;

    // Reentrega do MESMO evento: 200 sem reprocessar.
    const repeated = await processBillingWebhook(
      parseBillingWebhookEvent(deliveries.at(-1)!.body)!,
      deliveries.at(-1)!.body,
    );
    expect(repeated.status).toBe(200);
    expect(repeated.body.duplicate).toBe(true);

    const second = await readSub(tenant.tenantId);
    expect(second?.currentPeriodEnd).toEqual(first?.currentPeriodEnd);

    const count = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId } }),
    );
    expect(count).toBe(1);
  });

  it('não vaza assinatura nem status entre tenants', async () => {
    const tenantA = await makeTenant('sub-iso-a');
    const tenantB = await makeTenant('sub-iso-b');

    const a = await subscribe({ tenantId: tenantA.tenantId, plan: 'SOLO', card: card(), provider });
    const b = await subscribe({ tenantId: tenantB.tenantId, plan: 'PRO', card: card(), provider });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    await provider.simulateInvoicePaymentFailed(a.providerSubscription.id);

    expect((await readSub(tenantA.tenantId))?.status).toBe('PAST_DUE');
    expect((await readSub(tenantB.tenantId))?.status).toBe('ACTIVE');
    expect((await readSub(tenantA.tenantId))?.stripeSubscriptionId).not.toBe(
      (await readSub(tenantB.tenantId))?.stripeSubscriptionId,
    );
  });
});
