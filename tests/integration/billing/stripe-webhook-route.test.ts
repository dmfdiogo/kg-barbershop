// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Stripe from 'stripe';

import { POST } from '@/app/api/webhooks/billing/route';
import { signBillingWebhook } from '@/lib/billing/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * A rota `/api/webhooks/billing` em `BILLING_PROVIDER=stripe` (F8.1-B), contra
 * o banco. Prova que: a assinatura nativa do Stripe é exigida; o token do mock
 * NÃO passa; replay é recusado; e evento não mapeado responde 200 sem tocar em
 * nada.
 */

const SECRET = 'whsec_route_stripe_secret';
const MOCK_SECRET = 'route-mock-token-secret';
const runId = randomUUID().slice(0, 8);
let seq = 0;

function stripeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `sub_stripe_${runId}`,
    object: 'subscription',
    customer: `cus_stripe_${runId}`,
    currency: 'brl',
    status: 'active',
    cancel_at_period_end: false,
    created: 1_760_000_000,
    items: {
      object: 'list',
      data: [
        {
          id: `si_${runId}`,
          object: 'subscription_item',
          current_period_end: 1_770_000_000,
          price: {
            id: 'price_solo',
            object: 'price',
            unit_amount: 3990,
            currency: 'brl',
            lookup_key: 'bom_horario_solo_mensal',
            metadata: { plan_code: 'SOLO' },
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('POST /api/webhooks/billing (BILLING_PROVIDER=stripe)', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  const subscriptionId = `sub_stripe_${runId}`;
  const customerId = `cus_stripe_${runId}`;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'wh-stripe');

    await admin.asPlatformAdmin((tx) =>
      tx.platformSub.create({
        data: {
          tenantId: fixture.tenantId,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          plan: 'SOLO',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2027-01-01T12:00:00.000Z'),
        },
      }),
    );
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_stripe_${runId}` } } }),
      );
      await admin.disconnect();
    }
  });

  beforeEach(async () => {
    vi.stubEnv('BILLING_PROVIDER', 'stripe');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('BILLING_WEBHOOK_SECRET', MOCK_SECRET);
    await admin.asPlatformAdmin((tx) =>
      tx.platformSub.update({
        where: { tenantId: fixture.tenantId },
        data: {
          status: 'ACTIVE',
          plan: 'SOLO',
          currentPeriodEnd: new Date('2027-01-01T12:00:00.000Z'),
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function buildEvent(type: string, object: Record<string, unknown>): string {
    return JSON.stringify({
      id: `evt_stripe_${runId}_${++seq}`,
      object: 'event',
      type,
      created: Math.floor(Date.now() / 1000),
      data: { object },
    });
  }

  function sign(payload: string, timestamp?: number): string {
    return Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: SECRET,
      ...(timestamp ? { timestamp } : {}),
    });
  }

  function postWebhook(rawBody: string, signature?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signature !== undefined) headers['stripe-signature'] = signature;
    return POST(
      new Request('http://localhost/api/webhooks/billing', {
        method: 'POST',
        headers,
        body: rawBody,
      }),
    );
  }

  function signedPost(rawBody: string): Promise<Response> {
    return postWebhook(rawBody, sign(rawBody));
  }

  function readStatus() {
    return forTenant(fixture.tenantId, (tx) =>
      tx.platformSub.findUnique({
        where: { tenantId: fixture.tenantId },
        select: { status: true },
      }),
    );
  }

  it('aceita evento assinado pelo Stripe e aplica a transição', async () => {
    const body = buildEvent(
      'customer.subscription.updated',
      stripeSubscription({ status: 'past_due' }),
    );

    const response = await signedPost(body);

    expect(response.status).toBe(200);
    expect((await readStatus())?.status).toBe('PAST_DUE');
  });

  it('recusa assinatura inválida (400) sem tocar no banco', async () => {
    const body = buildEvent(
      'customer.subscription.updated',
      stripeSubscription({ status: 'past_due' }),
    );
    const eventId = (JSON.parse(body) as { id: string }).id;

    const response = await postWebhook(body, 'assinatura-errada');

    expect(response.status).toBe(400);
    expect((await readStatus())?.status).toBe('ACTIVE');
    const count = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId } }),
    );
    expect(count).toBe(0);
  });

  it('recusa timestamp velho (replay) com 400', async () => {
    const body = buildEvent(
      'customer.subscription.updated',
      stripeSubscription({ status: 'past_due' }),
    );
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400;

    const response = await postWebhook(body, sign(body, oldTimestamp));

    expect(response.status).toBe(400);
    expect((await readStatus())?.status).toBe('ACTIVE');
  });

  it('ignora tipo não mapeado com 200 e nada acontece', async () => {
    const body = buildEvent('payment_intent.succeeded', {});

    const response = await signedPost(body);

    expect(response.status).toBe(200);
    expect(((await response.json()) as { ignored?: boolean }).ignored).toBe(true);
    expect((await readStatus())?.status).toBe('ACTIVE');
  });

  it('não aceita o token do mock quando o provider é stripe', async () => {
    const body = buildEvent(
      'customer.subscription.updated',
      stripeSubscription({ status: 'past_due' }),
    );
    // Token no formato do mock (HMAC hex puro), não o `t=...,v1=...` do Stripe.
    const mockToken = signBillingWebhook(body, MOCK_SECRET);

    const response = await postWebhook(body, mockToken);

    expect(response.status).toBe(400);
    expect((await readStatus())?.status).toBe('ACTIVE');
  });

  it('reentrega do mesmo eventId responde 200 sem duplicar', async () => {
    const body = buildEvent(
      'customer.subscription.updated',
      stripeSubscription({ status: 'past_due' }),
    );
    const signature = sign(body);

    const first = await postWebhook(body, signature);
    const repeated = await postWebhook(body, signature);

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { duplicate?: boolean }).duplicate).toBe(true);
  });
});
