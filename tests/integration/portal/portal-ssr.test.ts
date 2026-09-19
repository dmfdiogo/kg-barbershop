import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { getTenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
} from '../helpers/test-database';

/**
 * Portal público no SSR (F3.0).
 *
 * O critério de aceite da fase é "nenhuma resposta do portal expõe dado de
 * outro tenant, com teste": aqui a resposta é o HTML renderizado no servidor,
 * e a prova é de ponta a ponta — requisição de A resolve o contexto de A, a
 * query passa pelo client escopado e o markup final não contém o catálogo de B.
 * Também cobre o tenant sem tema (o `petspaluna` do seed), que precisa sair com
 * os padrões em vez de quebrar.
 *
 * `next/headers` é mockado com um host controlável para que a resolução
 * aconteça contra o banco de verdade, como na requisição real.
 */

const requestState = vi.hoisted(() => ({
  host: 'localhost:3000',
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-tenant-host': requestState.host }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

import PortalCatalogPage from '@/app/[slug]/(portal)/page';
import PortalLayout from '@/app/[slug]/(portal)/layout';
import TenantLayout from '@/app/[slug]/layout';

interface PortalTenantFixture {
  slug: string;
  serviceName: string;
  inactiveServiceName: string;
}

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

function normalize(text: string): string {
  return text.replace(/\u00a0/g, ' ');
}

describe('portal público — SSR, tema e isolamento', () => {
  let admin: TenantDb;
  let originalDatabaseUrl: string | undefined;
  let originalAppDomain: string | undefined;
  const created: string[] = [];

  let tenantA: PortalTenantFixture;
  let tenantB: PortalTenantFixture;
  let tenantEmpty: PortalTenantFixture;
  let suspendedSlug: string;

  beforeAll(async () => {
    // Fixado antes do `loadEnvFile` de `ensureTestDatabase` (que não
    // sobrescreve variável já definida): a classificação de host precisa ser
    // a mesma deste teste mesmo que o `.env` de quem roda tenha outro domínio.
    originalAppDomain = process.env.APP_DOMAIN;
    process.env.APP_DOMAIN = requestState.host;

    await ensureTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    // O global do contexto e o do client escopado leem DATABASE_URL. Aponta
    // para a role SEM superuser: é o único jeito de a RLS valer de fato.
    process.env.DATABASE_URL = rlsDatabaseUrl();
    admin = createAdminDb();

    async function createPortalTenant(options: {
      prefix: string;
      name: string;
      serviceName?: string;
      inactiveServiceName?: string;
      priceCents?: number;
      colorPrimary?: string | null;
      colorSecondary?: string | null;
      colorBackground?: string | null;
      themePreset?: string | null;
      status?: 'ACTIVE' | 'SUSPENDED';
      withServices?: boolean;
    }): Promise<PortalTenantFixture> {
      const id = suffix();
      const slug = `${options.prefix}-${id}`;
      const priceCents = options.priceCents ?? 5000;

      const tenant = await admin.asPlatformAdmin((tx) =>
        tx.tenant.create({
          data: {
            slug,
            name: options.name,
            document: '12345678901',
            status: options.status ?? 'ACTIVE',
            colorPrimary: options.colorPrimary ?? null,
            colorSecondary: options.colorSecondary ?? null,
            colorBackground: options.colorBackground ?? null,
            themePreset: options.themePreset ?? null,
          },
          select: { id: true },
        }),
      );
      created.push(tenant.id);

      const serviceName = options.serviceName ?? `Serviço ${id}`;
      const inactiveServiceName = options.inactiveServiceName ?? `Inativo ${id}`;

      if (options.withServices !== false) {
        await admin.asPlatformAdmin((tx) =>
          tx.service.create({
            data: {
              tenantId: tenant.id,
              name: serviceName,
              durationMin: 45,
              bufferMin: 10,
              priceCents,
              paymentMode: 'ON_SITE',
            },
          }),
        );
        await admin.asPlatformAdmin((tx) =>
          tx.service.create({
            data: {
              tenantId: tenant.id,
              name: inactiveServiceName,
              durationMin: 30,
              priceCents: 1,
              paymentMode: 'ON_SITE',
              active: false,
            },
          }),
        );
      }

      return {
        slug,
        serviceName,
        inactiveServiceName,
      };
    }

    tenantA = await createPortalTenant({
      prefix: 'portal-a',
      name: 'Salão Alfa',
      serviceName: 'Corte do Alfa',
      inactiveServiceName: 'Serviço desligado do Alfa',
      priceCents: 4321,
      colorPrimary: '#0f766e',
      colorSecondary: '#115e59',
      colorBackground: '#f0fdfa',
    });

    tenantB = await createPortalTenant({
      prefix: 'portal-b',
      name: 'Petshop Beta',
      serviceName: 'Banho do Beta',
      inactiveServiceName: 'Serviço desligado do Beta',
      priceCents: 9876,
      // Sem cores, mas com preset: é o estado do `petspaluna` no seed e tem de
      // cair nos padrões (o preset é resolvido pela F2.3, na edição).
      themePreset: 'pet-friendly',
    });

    tenantEmpty = await createPortalTenant({
      prefix: 'portal-vazio',
      name: 'Espaço Vazio',
      withServices: false,
    });

    suspendedSlug = (
      await createPortalTenant({
        prefix: 'portal-susp',
        name: 'Salão Suspenso',
        status: 'SUSPENDED',
      })
    ).slug;
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of created) await deleteTenant(admin, tenantId);
      await admin.disconnect();
    }
    await getTenantDb().disconnect();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalAppDomain === undefined) delete process.env.APP_DOMAIN;
    else process.env.APP_DOMAIN = originalAppDomain;
  });

  async function renderPortal(slug: string): Promise<string> {
    // Compõe como o Next compõe: página dentro do layout do grupo, que é onde
    // a casca injeta o tema. Sem isso o teste renderiza só o miolo.
    const page = await PortalCatalogPage({ params: Promise.resolve({ slug }) });
    const shell = await PortalLayout({ children: page, params: Promise.resolve({ slug }) });
    return normalize(renderToStaticMarkup(shell));
  }

  it('renderiza o catálogo de A com o tema de A no HTML', async () => {
    const html = await renderPortal(tenantA.slug);

    expect(html).toContain('Salão Alfa');
    expect(html).toContain('Corte do Alfa');
    expect(html).toContain('R$ 43,21');
    expect(html).toContain('45 min');
    expect(html).toContain('id="tenant-theme"');
    expect(html).toContain('--color-primary:#0f766e');
    expect(html).toContain('--color-background:#f0fdfa');
    expect(html).toContain('--color-foreground:#171717');
  });

  it('não expõe serviço do outro tenant (A não vê B, B não vê A)', async () => {
    const htmlA = await renderPortal(tenantA.slug);
    expect(htmlA).not.toContain(tenantB.serviceName);
    expect(htmlA).not.toContain('R$ 98,76');

    const htmlB = await renderPortal(tenantB.slug);
    expect(htmlB).not.toContain(tenantA.serviceName);
    expect(htmlB).not.toContain('R$ 43,21');
    expect(htmlB).not.toContain('--color-primary:#0f766e');
  });

  it('tenant sem tema configurado renderiza com os padrões', async () => {
    const html = await renderPortal(tenantB.slug);

    expect(html).toContain('Petshop Beta');
    expect(html).toContain('Banho do Beta');
    expect(html).toContain('--color-primary:#171717');
    expect(html).toContain('--color-background:#ffffff');
    expect(html).toContain('color-scheme:light');
  });

  it('serviço inativo não aparece no catálogo público', async () => {
    const html = await renderPortal(tenantA.slug);

    expect(html).toContain(tenantA.serviceName);
    expect(html).not.toContain(tenantA.inactiveServiceName);
  });

  it('tenant sem serviços mostra estado vazio, não erro', async () => {
    const html = await renderPortal(tenantEmpty.slug);

    expect(html).toContain('Espaço Vazio');
    expect(html).toContain('ainda não publicou serviços');
  });

  it('slug inexistente vira notFound()', async () => {
    await expect(renderPortal(`nao-existe-${suffix()}`)).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('tenant suspenso não renderiza o portal (o portão da F1.0 continua na frente)', async () => {
    const element = await TenantLayout({
      children: 'conteudo-do-portal',
      params: Promise.resolve({ slug: suspendedSlug }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('temporariamente suspenso');
    expect(html).not.toContain('conteudo-do-portal');
  });
});
