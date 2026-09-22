import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '@/lib/auth/session';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Funil da trial no painel (tarefa F8.4).
 *
 * O `TrialBanner` avisa que a trial está acabando e sugere um plano, mas o
 * aviso não levava a lugar nenhum: a tela onde se assina é `/painel/assinatura`
 * e só chegava quem digitava a URL. Aqui se prova que o link aparece para o
 * OWNER e some para o STAFF — que não assina nada.
 *
 * O aviso só existe a partir do 8º agendamento gratuito; o contador é
 * `Tenant.trialBookingsUsed`, então basta subi-lo no fixture, sem criar
 * agendamento nenhum.
 */

const authState = vi.hoisted(() => ({ sessionCookie: null as string | null }));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers({ host: 'localhost:3000', 'x-forwarded-proto': 'http' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'kg_session' && authState.sessionCookie
        ? { name, value: authState.sessionCookie }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

import InicioPage from '@/app/(dashboard)/painel/inicio/page';

async function userIdOf(admin: TenantDb, memberId: string): Promise<string> {
  const member = await admin.asPlatformAdmin((tx) =>
    tx.tenantMember.findUnique({ where: { id: memberId }, select: { userId: true } }),
  );
  return member?.userId ?? '';
}

describe('painel: banner da trial leva ao checkout', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenant: TenantFixture;
  let ownerUserId: string;
  let staffUserId: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenant = await createTenantFixture(admin, 'inicio-banner');
    ownerUserId = await userIdOf(admin, tenant.ownerMemberId);
    staffUserId = await userIdOf(admin, tenant.staffMemberId);

    // 8 usados = fase WARNING: o banner aparece com a sugestão de plano.
    await admin.asPlatformAdmin((tx) =>
      tx.tenant.update({
        where: { id: tenant.tenantId },
        data: { trialBookingsUsed: 8 },
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

  function login(userId: string): void {
    authState.sessionCookie = createSessionToken({
      userId,
      activeTenantId: tenant.tenantId,
    });
  }

  async function renderPage(): Promise<string> {
    return renderToStaticMarkup(await InicioPage());
  }

  it('mostra o link de assinar para o OWNER', async () => {
    login(ownerUserId);
    const html = await renderPage();

    expect(html).toContain('/painel/assinatura');
    expect(html).toContain('Escolher um plano');
  });

  it('não mostra o link para o STAFF, mas mantém o aviso', async () => {
    login(staffUserId);
    const html = await renderPage();

    // O aviso da trial continua (o profissional também vê que a trial anda),
    // mas quem assina é o dono.
    expect(html).toContain('agendamentos gratuitos');
    expect(html).not.toContain('/painel/assinatura');
    expect(html).not.toContain('Escolher um plano');
  });
});
