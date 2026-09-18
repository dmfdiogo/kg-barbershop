import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { AuthError, getAuthContext, requireRole, requireSuperAdmin, roleSatisfies, withRole } from '@/lib/auth/rbac';
import { createSessionToken } from '@/lib/auth/session';
import { TenantUnavailableError } from '@/lib/tenant/context';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * `requireRole` nos dois consumidores: Server Component (`await requireRole`) e
 * Route Handler (`withRole`). O `next/headers` é mockado porque fora do runtime
 * do Next não existe request scope — é o mesmo módulo que o RSC usa.
 *
 * O que este arquivo prova de mais importante: a MESMA pessoa, OWNER no salão A
 * e CUSTOMER no salão B, só enxerga o papel do tenant da requisição. Papel não
 * mora no token.
 */

const authState = vi.hoisted(() => ({
  headers: new Headers(),
  sessionCookie: null as string | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => authState.headers,
  cookies: async () => ({
    get: (name: string) =>
      name === 'kg_session' && authState.sessionCookie
        ? { name, value: authState.sessionCookie }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

const APP_HOST = 'localhost:3000';

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

describe('requireRole e sessão multi-tenant', () => {
  let admin: TenantDb;
  let tenantA: { id: string; slug: string };
  let tenantB: { id: string; slug: string };
  let tenantSuspended: { id: string; slug: string };
  let tenantOther: { id: string; slug: string };
  let user: { id: string };
  let superUser: { id: string };
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();

    const id = suffix();
    const createTenant = async (slug: string, status?: 'SUSPENDED') => {
      const tenant = await admin.asPlatformAdmin((tx) =>
        tx.tenant.create({
          data: {
            slug,
            name: `RBAC ${slug}`,
            document: '12345678901',
            status,
          },
          select: { id: true, slug: true },
        }),
      );
      createdTenants.push(tenant.id);
      return tenant;
    };

    tenantA = await createTenant(`rbac-a-${id}`);
    tenantB = await createTenant(`rbac-b-${id}`);
    tenantSuspended = await createTenant(`rbac-susp-${id}`, 'SUSPENDED');
    tenantOther = await createTenant(`rbac-other-${id}`);

    user = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: `+5548${id}1`, name: 'Pessoa Multi-tenant' },
        select: { id: true },
      }),
    );
    superUser = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: `+5548${id}2`, name: 'Super Admin', isSuperAdmin: true },
        select: { id: true },
      }),
    );

    // A MESMA pessoa: OWNER no salão A, CUSTOMER no salão B, OWNER no suspenso.
    await admin.asPlatformAdmin(async (tx) => {
      await tx.tenantMember.create({ data: { tenantId: tenantA.id, userId: user.id, role: 'OWNER' } });
      await tx.tenantMember.create({ data: { tenantId: tenantB.id, userId: user.id, role: 'CUSTOMER' } });
      await tx.tenantMember.create({
        data: { tenantId: tenantSuspended.id, userId: user.id, role: 'OWNER' },
      });
    });
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of createdTenants) await deleteTenant(admin, tenantId);
      if (superUser) await admin.asPlatformAdmin((tx) => tx.user.delete({ where: { id: superUser.id } }));
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.headers = new Headers({ 'x-tenant-host': APP_HOST });
    authState.sessionCookie = null;
  });

  function useTenant(tenant: { slug: string }): void {
    authState.headers.set('x-tenant-slug', tenant.slug);
  }

  function useSession(userId: string, activeTenantId: string | null = null): void {
    authState.sessionCookie = createSessionToken({ userId, activeTenantId });
  }

  it('papel é lido do TenantMember do tenant da requisição (RSC)', async () => {
    useTenant(tenantA);
    useSession(user.id, tenantA.id);

    const context = await requireRole('OWNER');

    expect(context.role).toBe('OWNER');
    expect(context.tenant.id).toBe(tenantA.id);
    expect(context.member.tenantId).toBe(tenantA.id);
  });

  it('a mesma pessoa é CUSTOMER no outro salão e não passa em requireRole(OWNER)', async () => {
    useTenant(tenantB);
    useSession(user.id, tenantA.id);

    await expect(requireRole('OWNER')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'FORBIDDEN',
      status: 403,
    });

    const context = await requireRole('CUSTOMER');
    expect(context.role).toBe('CUSTOMER');
    expect(context.tenant.id).toBe(tenantB.id);
  });

  it('hierarquia: OWNER satisfaz STAFF; CUSTOMER não satisfaz STAFF', () => {
    expect(roleSatisfies('OWNER', ['STAFF'])).toBe(true);
    expect(roleSatisfies('STAFF', ['OWNER'])).toBe(false);
    expect(roleSatisfies('CUSTOMER', [])).toBe(true);
  });

  it('sem sessão, requireRole nega com 401', async () => {
    useTenant(tenantA);

    await expect(requireRole('OWNER')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });

  it('autenticado sem membership no tenant recebe 403, não 401 (sem laço de login)', async () => {
    useTenant(tenantOther);
    useSession(user.id, tenantA.id);

    await expect(getAuthContext()).resolves.toBeNull();
    await expect(requireRole()).rejects.toMatchObject({
      name: 'AuthError',
      code: 'FORBIDDEN',
      status: 403,
    });

    const handler = withRole([], () => Response.json({ ok: true }));
    const response = await handler(new Request(`https://${APP_HOST}/painel`));
    expect(response.status).toBe(403);
  });

  it('sessão sem tenant ativo em rota sem tenant é 403 (não há contexto para autorizar)', async () => {
    useSession(user.id, null);

    await expect(requireRole('OWNER')).rejects.toMatchObject({
      name: 'AuthError',
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('route handler: withRole deixa passar e nega com o status certo', async () => {
    const handler = withRole(['OWNER'], (context) =>
      Response.json({ role: context.role, tenantId: context.tenant.id }),
    );

    useTenant(tenantA);
    useSession(user.id, tenantA.id);
    const allowed = await handler(new Request(`https://${APP_HOST}/painel`));
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({ role: 'OWNER', tenantId: tenantA.id });

    useTenant(tenantB);
    const forbidden = await handler(new Request(`https://${APP_HOST}/painel`));
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({ error: 'FORBIDDEN' });

    authState.sessionCookie = null;
    const anonymous = await handler(new Request(`https://${APP_HOST}/painel`));
    expect(anonymous.status).toBe(401);
    await expect(anonymous.json()).resolves.toMatchObject({ error: 'UNAUTHENTICATED' });
  });

  it('tenant suspenso não deixa rota nenhuma renderizar, nem para membro', async () => {
    useTenant(tenantSuspended);
    useSession(user.id, tenantSuspended.id);

    await expect(requireRole('OWNER')).rejects.toBeInstanceOf(TenantUnavailableError);

    const handler = withRole(['OWNER'], () => Response.json({ ok: true }));
    const response = await handler(new Request(`https://${APP_HOST}/painel`));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: 'suspended' });
  });

  it('rota sem tenant no caminho usa o tenant ativo da sessão (/painel)', async () => {
    useSession(user.id, tenantA.id);

    const context = await requireRole('OWNER');

    expect(context.tenant.id).toBe(tenantA.id);
    expect(context.source).toBe('session');
  });

  it('tenant ativo da sessão que ficou suspenso é barrado', async () => {
    useSession(user.id, tenantSuspended.id);

    await expect(requireRole('OWNER')).rejects.toMatchObject({ code: 'suspended' });
  });

  it('requireSuperAdmin exige User.isSuperAdmin', async () => {
    useSession(user.id, tenantA.id);
    await expect(requireSuperAdmin()).rejects.toBeInstanceOf(AuthError);

    useSession(superUser.id);
    const context = await requireSuperAdmin();
    expect(context.user.isSuperAdmin).toBe(true);

    authState.sessionCookie = null;
    await expect(requireSuperAdmin()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
