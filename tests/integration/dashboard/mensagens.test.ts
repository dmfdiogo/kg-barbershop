import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import { setMessagingOptOut } from '@/lib/messaging/preferences';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Área de mensagens e privacidade (tarefa F6.2).
 *
 * Prova o portão de OWNER (o Staff recebe o 404 do segmento), o redirect de
 * quem não tem sessão, a renderização da tela com o log de entrega e a rota de
 * exportação exigindo o dono e devolvendo JSON.
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
  usePathname: () => '/painel/mensagens',
}));

import MensagensLayout from '@/app/(dashboard)/painel/mensagens/layout';
import MensagensPage from '@/app/(dashboard)/painel/mensagens/page';
import { GET as exportRoute } from '@/app/(dashboard)/painel/mensagens/exportar/route';

describe('área de mensagens e privacidade', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenant: TenantFixture;
  let ownerUserId: string;
  let staffUserId: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
    tenant = await createTenantFixture(admin, 'mensagens');

    const [owner, staff, customer] = await admin.asPlatformAdmin((tx) =>
      Promise.all([
        tx.tenantMember.findUnique({
          where: { id: tenant.ownerMemberId },
          select: { userId: true },
        }),
        tx.tenantMember.findUnique({
          where: { id: tenant.staffMemberId },
          select: { userId: true },
        }),
        tx.tenantMember.findUnique({
          where: { id: tenant.customerMemberId },
          select: { userId: true },
        }),
      ]),
    );
    ownerUserId = owner?.userId ?? '';
    staffUserId = staff?.userId ?? '';

    await scoped.forTenant(tenant.tenantId, (tx) =>
      setMessagingOptOut(tx, {
        tenantId: tenant.tenantId,
        userId: customer?.userId ?? '',
      }),
    );
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenant) await deleteTenant(admin, tenant.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  it('o dono acessa a tela; o Staff recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserId,
      activeTenantId: tenant.tenantId,
    });
    const html = renderToStaticMarkup(
      await MensagensLayout({ children: 'conteudo-de-mensagens' }),
    );
    expect(html).toContain('conteudo-de-mensagens');

    authState.sessionCookie = createSessionToken({
      userId: staffUserId,
      activeTenantId: tenant.tenantId,
    });
    await expect(MensagensLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a tela manda para a raiz', async () => {
    await expect(MensagensLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('a página mostra preferências e o log de entrega', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserId,
      activeTenantId: tenant.tenantId,
    });

    const html = renderToStaticMarkup(await MensagensPage());

    expect(html).toContain('Log de entrega');
    expect(html).toContain('Preferências e direitos do titular');
    expect(html).toContain('Opt-out ativo');
  });

  it('a exportação exige o dono e devolve JSON do titular', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserId,
      activeTenantId: tenant.tenantId,
    });

    const response = await exportRoute(
      new Request(
        `http://localhost/painel/mensagens/exportar?membro=${tenant.customerMemberId}`,
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { subject: { memberId: string } };
    expect(body.subject.memberId).toBe(tenant.customerMemberId);
  });
});
