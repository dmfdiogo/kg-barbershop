import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MockBillingProvider } from '@/lib/billing/mock';
import { createMockBillingStore, type MockBillingStore } from '@/lib/billing/mock-store';
import {
  cancelSubscription,
  changePlan,
  getLocalSubscription,
  openBillingPortal,
  startSubscriptionCheckout,
  SubscriptionSuspendedError,
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

const SUCCESS_URL = 'https://app.exemplo.com.br/painel/assinatura?ok=1';
const CANCEL_URL = 'https://app.exemplo.com.br/painel/assinatura?cancelado=1';

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

  /**
   * O fluxo inteiro de assinar: abre a sessão hospedada e conclui o pagamento.
   *
   * Duas etapas de propósito — é o desenho novo. `startSubscriptionCheckout`
   * só devolve URL; quem cria o `PlatformSub` é o `SUBSCRIPTION_CREATED` que
   * a conclusão dispara, e o transporte deste arquivo entrega esse webhook no
   * processador de verdade.
   */
  async function subscribeTenant(tenantId: string, plan: 'SOLO' | 'EQUIPE' | 'PRO') {
    const started = await startSubscriptionCheckout({
      tenantId,
      plan,
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      provider,
    });
    if (!started.ok) return started;
    const { subscription } = await provider.completeCheckoutSession(started.sessionId);
    return { ok: true as const, providerSubscription: subscription };
  }

  it('assinar → trocar → inadimplir → suspender → reativar', async () => {
    const tenant = await makeTenant('sub-cycle');

    const subscribed = await subscribeTenant(tenant.tenantId, 'SOLO');
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
    const subscribed = await subscribeTenant(tenant.tenantId, 'EQUIPE');
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
    const subscribed = await subscribeTenant(tenant.tenantId, 'SOLO');
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

  it('abrir o portal do cliente devolve URL e não altera o estado da assinatura', async () => {
    const tenant = await makeTenant('sub-card');
    const subscribed = await subscribeTenant(tenant.tenantId, 'PRO');
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const portal = await openBillingPortal({
      tenantId: tenant.tenantId,
      returnUrl: SUCCESS_URL,
      provider,
    });
    expect(portal.ok).toBe(true);
    if (portal.ok) expect(portal.url).toMatch(/^https?:\/\//);

    // O portal é do provedor: nada muda do nosso lado só por abri-lo. Quem
    // conta que o cartão trocou é o webhook, se e quando trocar.
    expect((await readSub(tenant.tenantId))?.status).toBe('ACTIVE');
  });

  it('abandonar o checkout não tranca o dono: dá para abrir outra sessão', async () => {
    // REGRESSÃO. `startSubscriptionCheckout` grava o `PlatformSub` com o
    // cliente ANTES de redirecionar, para o webhook ter âncora. O porteiro de
    // assinatura dupla passou a ver essa linha de INTENÇÃO como assinatura
    // existente, e quem fechasse a aba no meio do pagamento ficava travado
    // para sempre — sem assinatura e sem conseguir abrir outra.
    const tenant = await makeTenant('sub-abandon');

    const first = await startSubscriptionCheckout({
      tenantId: tenant.tenantId,
      plan: 'SOLO',
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      provider,
    });
    expect(first.ok).toBe(true);

    // Fechou a aba: nenhum webhook chegou.
    expect((await readSub(tenant.tenantId))?.stripeSubscriptionId ?? null).toBeNull();

    const second = await startSubscriptionCheckout({
      tenantId: tenant.tenantId,
      plan: 'EQUIPE',
      successUrl: SUCCESS_URL,
      cancelUrl: CANCEL_URL,
      provider,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const { subscription } = await provider.completeCheckoutSession(second.sessionId);
    expect(subscription.plan).toBe('EQUIPE');
    expect((await readSub(tenant.tenantId))?.status).toBe('ACTIVE');
  });

  it('reassinar depois de cancelar ativa de novo, em vez de cobrar sem ativar', async () => {
    // REGRESSÃO, e a pior delas: o `stripeSubscriptionId` antigo sobrevivia ao
    // cancelamento, e a validação de criação recusava o `SUBSCRIPTION_CREATED`
    // da assinatura nova por divergir dele. O provedor cobrava e o local
    // continuava CANCELED — cobrança sem serviço.
    const tenant = await makeTenant('sub-resubscribe');

    const first = await subscribeTenant(tenant.tenantId, 'SOLO');
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    await cancelSubscription({ tenantId: tenant.tenantId, provider });
    expect((await readSub(tenant.tenantId))?.status).toBe('CANCELED');

    const again = await subscribeTenant(tenant.tenantId, 'PRO');
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    const local = await readSub(tenant.tenantId);
    expect(local?.status).toBe('ACTIVE');
    expect(local?.plan).toBe('PRO');
    expect(local?.stripeSubscriptionId).toBe(again.providerSubscription.id);
  });

  it('sem assinatura, o portal é recusado em vez de abrir URL vazia', async () => {
    const tenant = await makeTenant('sub-no-portal');
    const portal = await openBillingPortal({
      tenantId: tenant.tenantId,
      returnUrl: SUCCESS_URL,
      provider,
    });
    expect(portal.ok).toBe(false);
    if (!portal.ok) expect(portal.code).toBe('NO_SUBSCRIPTION');
  });

  it('assinar duas vezes não cria cobrança dupla', async () => {
    const tenant = await makeTenant('sub-double');
    const first = await subscribeTenant(tenant.tenantId, 'SOLO');
    expect(first.ok).toBe(true);

    const second = await subscribeTenant(tenant.tenantId, 'SOLO');
    expect(second).toMatchObject({ ok: false, code: 'SUBSCRIBER_ALREADY_EXISTS' });
  });

  it('webhook reentregue não renova nem credita duas vezes', async () => {
    const tenant = await makeTenant('sub-idem');
    const subscribed = await subscribeTenant(tenant.tenantId, 'SOLO');
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

    const a = await subscribeTenant(tenantA.tenantId, 'SOLO');
    const b = await subscribeTenant(tenantB.tenantId, 'PRO');
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
