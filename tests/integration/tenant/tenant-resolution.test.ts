import { randomInt } from 'node:crypto';
import type { TenantStatus } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTenantDb, type TenantDb } from '@/lib/tenant/db';
import { resolveTenant, toTenantContext } from '@/lib/tenant/context';
import {
  createAdminDb,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
} from '../helpers/test-database';

/**
 * As três formas de resolução contra o banco de verdade, incluindo a projeção
 * estreita e o runner escopado que o contexto entrega.
 *
 * O proxy (extração de host/slug) tem teste unitário próprio; aqui o que se
 * prova é a resolução: host → customDomain, subdomínio → slug, path → slug,
 * mais status e recusa de reservado.
 */

const APP_DOMAIN = 'app.agendex.test';

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

describe('resolução de tenant contra o banco', () => {
  let admin: TenantDb;
  let originalDatabaseUrl: string | undefined;
  const created: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    admin = createAdminDb();
    // O runner do contexto usa o client global, que lê DATABASE_URL. No
    // ambiente de dev/CI a role é superuser e ignora RLS; aponta para a role
    // comum para que o forTenant() do contexto seja provado de verdade, como
    // em produção (mesmo esquema de tests/integration/tenant-isolation).
    process.env.DATABASE_URL = rlsDatabaseUrl();
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of created) await deleteTenant(admin, tenantId);
      await admin.disconnect();
    }
    await getTenantDb().disconnect();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function createTenant(options: {
    status?: TenantStatus;
    customDomain?: string;
  } = {}) {
    const id = suffix();
    const tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: {
          slug: `res-${id}`,
          name: `Resolução ${id}`,
          document: '12345678901',
          status: options.status,
          customDomain: options.customDomain,
        },
      }),
    );
    created.push(tenant.id);
    return tenant;
  }

  it('1. domínio próprio: Host casa com Tenant.customDomain', async () => {
    const customDomain = `salao-${suffix()}.com.br`;
    const tenant = await createTenant({ customDomain });

    const lookup = await resolveTenant({ host: customDomain, routeSlug: null, appDomain: APP_DOMAIN });

    expect(lookup).toMatchObject({ ok: true, source: 'custom-domain' });
    if (lookup.ok) {
      expect(lookup.tenant.id).toBe(tenant.id);
      expect(lookup.tenant.slug).toBe(tenant.slug);
    }
  });

  it('domínio próprio aceita host com porta (desenvolvimento)', async () => {
    const customDomain = `salao-${suffix()}.com.br`;
    const tenant = await createTenant({ customDomain });

    const lookup = await resolveTenant({
      host: `${customDomain}:3000`,
      routeSlug: null,
      appDomain: APP_DOMAIN,
    });

    expect(lookup).toMatchObject({ ok: true, source: 'custom-domain' });
    if (lookup.ok) expect(lookup.tenant.id).toBe(tenant.id);
  });

  it('2. subdomínio: slug no rótulo à esquerda do domínio base', async () => {
    const tenant = await createTenant();

    const lookup = await resolveTenant({
      host: `${tenant.slug}.${APP_DOMAIN}`,
      appDomain: APP_DOMAIN,
    });

    expect(lookup).toMatchObject({ ok: true, source: 'subdomain' });
    if (lookup.ok) expect(lookup.tenant.id).toBe(tenant.id);
  });

  it('3. path: params.slug da rota /[slug]', async () => {
    const tenant = await createTenant();

    const lookup = await resolveTenant({ host: APP_DOMAIN, routeSlug: tenant.slug, appDomain: APP_DOMAIN });

    expect(lookup).toMatchObject({ ok: true, source: 'path' });
    if (lookup.ok) expect(lookup.tenant.id).toBe(tenant.id);
  });

  it('header do proxy (x-tenant-slug) resolve o path, mas params.slug manda', async () => {
    const pathTenant = await createTenant();
    const headerTenant = await createTenant();

    const byHeader = await resolveTenant({
      host: APP_DOMAIN,
      headerSlug: pathTenant.slug,
      appDomain: APP_DOMAIN,
    });
    expect(byHeader.ok && byHeader.tenant.id).toBe(pathTenant.id);

    // Os dois presentes: a URL é autoritativa (o header é conveniência do proxy).
    const byRoute = await resolveTenant({
      host: APP_DOMAIN,
      routeSlug: pathTenant.slug,
      headerSlug: headerTenant.slug,
      appDomain: APP_DOMAIN,
    });
    expect(byRoute.ok && byRoute.tenant.id).toBe(pathTenant.id);
  });

  it('slug reservado nunca resolve para um tenant', async () => {
    const lookup = await resolveTenant({ host: APP_DOMAIN, routeSlug: 'painel', appDomain: APP_DOMAIN });
    expect(lookup).toMatchObject({ ok: false, reason: 'not_found' });

    const subdomain = await resolveTenant({
      host: `painel.${APP_DOMAIN}`,
      appDomain: APP_DOMAIN,
    });
    expect(subdomain).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('inexistente é not_found; sem identificador é missing', async () => {
    const missing = await resolveTenant({ host: APP_DOMAIN, appDomain: APP_DOMAIN });
    expect(missing).toMatchObject({ ok: false, reason: 'missing' });

    const notFound = await resolveTenant({
      host: APP_DOMAIN,
      routeSlug: `nao-existe-${suffix()}`,
      appDomain: APP_DOMAIN,
    });
    expect(notFound).toMatchObject({ ok: false, reason: 'not_found', tenant: null });

    const unknownDomain = await resolveTenant({
      host: `desconhecido-${suffix()}.com.br`,
      appDomain: APP_DOMAIN,
    });
    expect(unknownDomain).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('suspenso e inativo têm motivo próprio; PAST_DUE segue operando (graça da F7)', async () => {
    const suspended = await createTenant({ status: 'SUSPENDED' });
    const inactive = await createTenant({ status: 'CANCELED' });
    const pastDue = await createTenant({ status: 'PAST_DUE' });

    const suspendedLookup = await resolveTenant({
      host: APP_DOMAIN,
      routeSlug: suspended.slug,
      appDomain: APP_DOMAIN,
    });
    expect(suspendedLookup).toMatchObject({ ok: false, reason: 'suspended' });
    expect(!suspendedLookup.ok && suspendedLookup.tenant?.id).toBe(suspended.id);

    const inactiveLookup = await resolveTenant({
      host: APP_DOMAIN,
      routeSlug: inactive.slug,
      appDomain: APP_DOMAIN,
    });
    expect(inactiveLookup).toMatchObject({ ok: false, reason: 'inactive' });

    const pastDueLookup = await resolveTenant({
      host: APP_DOMAIN,
      routeSlug: pastDue.slug,
      appDomain: APP_DOMAIN,
    });
    expect(pastDueLookup).toMatchObject({ ok: true, source: 'path' });
  });

  it('o tenant resolvido entrega um runner escopado no client da F0', async () => {
    const tenant = await createTenant();
    await admin.asPlatformAdmin((tx) =>
      tx.service.create({
        data: {
          tenantId: tenant.id,
          name: 'Corte de teste',
          durationMin: 30,
          priceCents: 5000,
          paymentMode: 'ON_SITE',
        },
      }),
    );

    const lookup = await resolveTenant({ host: APP_DOMAIN, routeSlug: tenant.slug, appDomain: APP_DOMAIN });
    expect(lookup.ok).toBe(true);
    if (!lookup.ok) return;

    const context = toTenantContext(lookup);
    const services = await context.forTenant((tx) =>
      tx.service.findMany({ select: { tenantId: true } }),
    );

    expect(services).toHaveLength(1);
    expect(services[0]?.tenantId).toBe(tenant.id);
  });
});
