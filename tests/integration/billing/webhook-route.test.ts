// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/webhooks/billing/route';
import {
  BILLING_WEBHOOK_TOKEN_HEADER,
  signBillingWebhook,
  type BillingWebhookEvent,
} from '@/lib/billing/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * A rota real `/api/webhooks/billing` (F7.2). Prova a ordem do contrato:
 * assinatura ANTES de qualquer coisa, parse, persistência e idempotência,
 * contra o banco.
 */

const SECRET = 'route-billing-secret';
const runId = randomUUID().slice(0, 8);
let seq = 0;

describe('POST /api/webhooks/billing', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let subscriptionId: string;
  let customerId: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'wh-billing');

    subscriptionId = `sub_route_${runId}`;
    customerId = `cus_route_${runId}`;
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
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_${runId}` } } }),
      );
      await admin.disconnect();
    }
  });

  beforeEach(async () => {
    vi.stubEnv('BILLING_WEBHOOK_SECRET', SECRET);
    // Cada caso parte do mesmo estado: sem isto, um teste que suspende o tenant
    // contaminaria o seguinte (a rota e o tenant são compartilhados no arquivo).
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

  function buildEvent(
    type: BillingWebhookEvent['type'],
    overrides: Partial<BillingWebhookEvent['data']['subscription']> = {},
  ): BillingWebhookEvent {
    return {
      provider: 'mock',
      eventId: `evt_${runId}_${++seq}`,
      type,
      occurredAt: new Date().toISOString(),
      data: {
        subscription: {
          id: subscriptionId,
          customerId,
          plan: 'SOLO',
          status: type === 'INVOICE_PAYMENT_FAILED' ? 'PAST_DUE' : 'ACTIVE',
          amountCents: 3990,
          currentPeriodEnd: '2027-02-01T12:00:00.000Z',
          cancelAtPeriodEnd: false,
          ...overrides,
        },
      },
    };
  }

  function postWebhook(rawBody: string, signature?: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (signature !== undefined) {
      headers[BILLING_WEBHOOK_TOKEN_HEADER] = signature;
    }
    return POST(
      new Request('http://localhost/api/webhooks/billing', {
        method: 'POST',
        headers,
        body: rawBody,
      }),
    );
  }

  function signedPost(event: BillingWebhookEvent): Promise<Response> {
    const body = JSON.stringify(event);
    return postWebhook(body, signBillingWebhook(body, SECRET));
  }

  function readStatus() {
    return forTenant(fixture.tenantId, (tx) =>
      tx.platformSub.findUnique({
        where: { tenantId: fixture.tenantId },
        select: { status: true },
      }),
    );
  }

  it('aceita evento assinado e muda o estado no banco', async () => {
    const response = await signedPost(buildEvent('INVOICE_PAYMENT_FAILED'));

    expect(response.status).toBe(200);
    expect((await readStatus())?.status).toBe('PAST_DUE');
  });

  it('responde 401 sem assinatura válida, sem tocar no estado', async () => {
    const response = await postWebhook(JSON.stringify(buildEvent('INVOICE_PAYMENT_FAILED')), 'errada');

    expect(response.status).toBe(401);
    expect((await readStatus())?.status).toBe('ACTIVE');
  });

  it('responde 400 para corpo inválido', async () => {
    const body = '{ "provider": "mock" }';
    const response = await postWebhook(body, signBillingWebhook(body, SECRET));
    expect(response.status).toBe(400);
  });

  it('reentrega do mesmo eventId responde 200 sem duplicar', async () => {
    const event = buildEvent('INVOICE_PAYMENT_FAILED');
    const body = JSON.stringify(event);

    const first = await postWebhook(body, signBillingWebhook(body, SECRET));
    const repeated = await postWebhook(body, signBillingWebhook(body, SECRET));

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { duplicate?: boolean }).duplicate).toBe(true);
    const count = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId: event.eventId } }),
    );
    expect(count).toBe(1);
  });

  it('assinatura desconhecida responde 404', async () => {
    const event = buildEvent('INVOICE_PAID', {
      id: `sub_missing_${runId}`,
      customerId: `cus_missing_${runId}`,
    });
    const response = await signedPost(event);
    expect(response.status).toBe(404);
  });

  it('assinatura do payload divergente do registro local responde 400', async () => {
    const event = buildEvent('INVOICE_PAID', { id: `sub_outro_${runId}` });
    const response = await signedPost(event);
    expect(response.status).toBe(400);
  });

  it('valor divergente do preço configurado responde 400', async () => {
    const event = buildEvent('INVOICE_PAID', { amountCents: 1 });
    const response = await signedPost(event);
    expect(response.status).toBe(400);
    expect((await readStatus())?.status).toBe('ACTIVE');
  });
});
