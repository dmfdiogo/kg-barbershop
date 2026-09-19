import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import { requireRole } from '@/lib/auth/rbac';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * Portão, shell e isolamento do painel do estabelecimento (tronco F2.0).
 *
 * Prova, com banco real:
 *   - sem sessão, o visitante volta para a raiz;
 *   - CUSTOMER (mesmo membro do tenant) não entra no painel — 404 do segmento;
 *   - STAFF vê o menu sem os itens de configuração; OWNER vê todos;
 *   - o papel é lido de `TenantMember` POR TENANT: a mesma pessoa que é OWNER no
 *     salão A é barrada no salão B onde é CUSTOMER;
 *   - o painel de um tenant não expõe nome nem dado do outro.
 *
 * `next/headers`/`next/navigation` são mockados como no teste do portão da
 * plataforma: `notFound()`/`redirect()` fora do runtime do Next lançam um erro
 * sentinela — exatamente o que queremos observar.
 */

const authState = vi.hoisted(() => ({
  sessionCookie: null as string | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-tenant-host': 'localhost:3000' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'kg_session' && authState.sessionCookie
        ? { name, value: authState.sessionCookie }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  usePathname: () => '/painel',
}));

import PainelLayout from '@/app/(dashboard)/painel/layout';

interface TenantRef {
  id: string;
  name: string;
  slug: string;
}

describe('painel do estabelecimento', () => {
  let admin: TenantDb;
  let tenantA: TenantRef;
  let tenantB: TenantRef;
  let ownerA: { id: string };
  let staffA: { id: string };
  let customerA: { id: string };
  let cross: { id: string };

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();

    const id = String(randomInt(0, 999_999)).padStart(6, '0');

    tenantA = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: { slug: `painel-a-${id}`, name: `Barbearia Painel A ${id}`, document: '12345678901' },
        select: { id: true, name: true, slug: true },
      }),
    );
    tenantB = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: { slug: `painel-b-${id}`, name: `Pet Shop Painel B ${id}`, document: '98765432000155' },
        select: { id: true, name: true, slug: true },
      }),
    );

    const [ownerAUser, staffAUser, customerAUser, crossUser] = await admin.asPlatformAdmin(
      async (tx) =>
        Promise.all([
          tx.user.create({ data: { phone: `+5548${id}01`, name: 'Dono A' } }),
          tx.user.create({ data: { phone: `+5548${id}02`, name: 'Equipe A' } }),
          tx.user.create({ data: { phone: `+5548${id}03`, name: 'Cliente A' } }),
          tx.user.create({ data: { phone: `+5548${id}04`, name: 'Dono no A, cliente no B' } }),
        ]),
    );

    await admin.asPlatformAdmin(async (tx) => {
      await tx.tenantMember.create({
        data: { tenantId: tenantA.id, userId: ownerAUser.id, role: 'OWNER' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantA.id, userId: staffAUser.id, role: 'STAFF' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantA.id, userId: customerAUser.id, role: 'CUSTOMER' },
      });
      // A MESMA pessoa em dois papéis, em tenants diferentes.
      await tx.tenantMember.create({
        data: { tenantId: tenantA.id, userId: crossUser.id, role: 'OWNER' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantB.id, userId: crossUser.id, role: 'CUSTOMER' },
      });
      await tx.service.create({
        data: {
          tenantId: tenantA.id,
          name: 'Corte do salão A',
          durationMin: 30,
          bufferMin: 0,
          priceCents: 5000,
          paymentMode: 'ON_SITE',
        },
      });
      await tx.service.create({
        data: {
          tenantId: tenantB.id,
          name: 'Banho do pet shop B',
          durationMin: 60,
          bufferMin: 0,
          priceCents: 9000,
          paymentMode: 'ON_SITE',
        },
      });
    });

    ownerA = ownerAUser;
    staffA = staffAUser;
    customerA = customerAUser;
    cross = crossUser;
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.id);
      if (tenantB) await deleteTenant(admin, tenantB.id);
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  async function renderPanel(children = 'conteúdo do painel'): Promise<string> {
    const element = await PainelLayout({ children });
    return renderToStaticMarkup(element);
  }

  it('sem sessão manda para a raiz', async () => {
    await expect(PainelLayout({ children: 'painel' })).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('cliente do tenant não acessa o painel: recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: customerA.id,
      activeTenantId: tenantA.id,
    });

    await expect(PainelLayout({ children: 'painel' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a equipe vê o painel, mas não o item de configuração', async () => {
    authState.sessionCookie = createSessionToken({ userId: staffA.id, activeTenantId: tenantA.id });

    const html = await renderPanel();

    expect(html).toContain('conteúdo do painel');
    expect(html).toContain('Equipe');
    expect(html).toContain('Agenda');
    expect(html).not.toContain('Configurações');
  });

  it('o dono vê o item de configuração', async () => {
    authState.sessionCookie = createSessionToken({ userId: ownerA.id, activeTenantId: tenantA.id });

    const html = await renderPanel();

    expect(html).toContain('Dono');
    expect(html).toContain('Configurações');
  });

  it('o papel vem do TenantMember por tenant, não do token', async () => {
    // A mesma pessoa: OWNER no salão A (entra), CUSTOMER no salão B (barrada).
    authState.sessionCookie = createSessionToken({ userId: cross.id, activeTenantId: tenantA.id });
    const comoDono = await renderPanel();
    expect(comoDono).toContain('Configurações');

    authState.sessionCookie = createSessionToken({ userId: cross.id, activeTenantId: tenantB.id });
    await expect(PainelLayout({ children: 'painel' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('o painel de um tenant não expõe nome nem dado do outro', async () => {
    authState.sessionCookie = createSessionToken({ userId: ownerA.id, activeTenantId: tenantA.id });

    const html = await renderPanel();
    expect(html).toContain(tenantA.name);
    expect(html).not.toContain(tenantB.name);

    // O caminho que uma tela de feature usa: o client escopado do contexto.
    const context = await requireRole('OWNER');
    const services = await context.forTenant((tx) =>
      tx.service.findMany({ select: { name: true } }),
    );

    expect(services.map((service) => service.name)).toEqual(['Corte do salão A']);
  });
});
