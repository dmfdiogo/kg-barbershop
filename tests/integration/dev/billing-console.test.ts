// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as completeCheckout } from '@/app/dev/api/billing/checkout/complete/route';
import { POST as billingWebhook } from '@/app/api/webhooks/billing/route';
import { resetMockBillingProvider } from '@/lib/billing/mock';
import { getMockBillingStore, resetMockBillingStore } from '@/lib/billing/mock-store';
import { startSubscriptionCheckout } from '@/lib/billing/subscription';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Console `/dev/billing` (F8.0-A) com banco real.
 *
 * O caso de ouro é o caminho INTEIRO: abrir a sessão pelo produto
 * (`startSubscriptionCheckout`), concluir pela action do console, e deixar o
 * mock disparar um POST HTTP de verdade para `/api/webhooks/billing` — porque é
 * o webhook, e só ele, que grava o `PlatformSub` da aplicação.
 */

const SECRET = 'dev-billing-console-secret';

function formRequest(url: string, fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request(url, { method: 'POST', body: form });
}

interface WebhookServer {
  url: string;
  close(): Promise<void>;
}

/** Faz o papel do servidor do provedor: recebe o POST e chama a rota real. */
async function startBillingWebhookServer(): Promise<WebhookServer> {
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (value === undefined) {
          continue;
        }
        headers[key] = Array.isArray(value) ? value.join(', ') : value;
      }

      void billingWebhook(
        new Request('http://localhost/api/webhooks/billing', {
          method: 'POST',
          headers,
          body,
        }),
      )
        .then(async (result) => {
          response.statusCode = result.status;
          response.setHeader('content-type', 'application/json');
          response.end(await result.text());
        })
        .catch((error: unknown) => {
          response.statusCode = 500;
          response.end(error instanceof Error ? error.message : String(error));
        });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Servidor de webhook de teste não conseguiu abrir porta.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/api/webhooks/billing`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

describe('console /dev/billing', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let server: WebhookServer | undefined;
  const createdEventIds: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'billing-console');
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) {
      await deleteTenant(admin, fixture.tenantId);
      if (createdEventIds.length > 0) {
        // `webhook_event` é global (não tem tenantId) e não cascateia do tenant.
        await admin.asPlatformAdmin((tx) =>
          tx.webhookEvent.deleteMany({ where: { eventId: { in: createdEventIds } } }),
        );
      }
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BILLING_WEBHOOK_SECRET', SECRET);
    resetMockBillingStore();
    resetMockBillingProvider();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = undefined;
    }
    vi.unstubAllEnvs();
  });

  function readPlatformSub() {
    return forTenant(fixture.tenantId, (tx) =>
      tx.platformSub.findUnique({
        where: { tenantId: fixture.tenantId },
        select: { plan: true, status: true, stripeSubscriptionId: true },
      }),
    );
  }

  it('bloqueia a action fora de desenvolvimento (404 no servidor)', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    const response = await completeCheckout(
      formRequest('http://localhost/dev/api/billing/checkout/complete', {
        sessionId: 'cs_billing_mock_1',
      }),
    );

    expect(response.status).toBe(404);
  });

  it('conclui a sessão e deixa o PlatformSub ACTIVE via webhook', async () => {
    server = await startBillingWebhookServer();
    vi.stubEnv('BILLING_WEBHOOK_URL', server.url);

    const opened = await startSubscriptionCheckout({
      tenantId: fixture.tenantId,
      plan: 'EQUIPE',
      successUrl: 'http://localhost/dev/billing',
      cancelUrl: 'http://localhost/dev/billing',
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    const before = await readPlatformSub();
    expect(before?.status).toBe('TRIALING');
    expect(before?.stripeSubscriptionId).toBeNull();

    const response = await completeCheckout(
      formRequest('http://localhost/dev/api/billing/checkout/complete', {
        sessionId: opened.sessionId,
      }),
    );

    expect(response.status).toBe(303);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('evento=SUBSCRIPTION_CREATED');
    expect(location).toContain('entregue=true');

    const delivery = getMockBillingStore().webhookDeliveries[0];
    if (delivery) {
      createdEventIds.push(delivery.eventId);
    }

    const after = await readPlatformSub();
    expect(after?.status).toBe('ACTIVE');
    expect(after?.plan).toBe('EQUIPE');
    expect(after?.stripeSubscriptionId).toBeTruthy();
  });
});
