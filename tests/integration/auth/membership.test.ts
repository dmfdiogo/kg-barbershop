import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MembershipError,
  ensureMembership,
  getMembership,
  listMyMemberships,
  switchActiveTenant,
} from '@/lib/auth/membership';
import { requireRole } from '@/lib/auth/rbac';
import { createSessionToken } from '@/lib/auth/session';
import { TenantUnavailableError } from '@/lib/tenant/context';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { postgresErrorCode } from '@/lib/tenant/errors';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Membership (F1.3): provisionamento no primeiro acesso, troca de contexto e
 * papel lido por requisição.
 *
 * O `next/headers` é mockado porque fora do runtime do Next não existe request
 * scope — e o mock de cookie GRAVA o `set`, para que a troca de contexto seja
 * observável (o que foi para o cookie depois de `switchActiveTenant`).
 *
 * A leitura de vínculo nos testes de isolamento usa a role NÃO-superuser: só
 * ela enxerga a RLS de verdade.
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
    set: (name: string, value: string) => {
      if (name === 'kg_session') authState.sessionCookie = value;
    },
    delete: (name: string) => {
      if (name === 'kg_session') authState.sessionCookie = null;
    },
  }),
}));

const APP_HOST = 'localhost:3000';

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

function sessionPayload(): Record<string, unknown> {
  const token = authState.sessionCookie;
  if (!token) throw new Error('A sessão não foi estabelecida.');
  const [, payload] = token.split('.');
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('membership: provisionamento e troca de contexto', () => {
  let admin: TenantDb;
  let rls: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let tenantSuspended: { id: string; slug: string };
  let tenantRole: { id: string; slug: string };
  let slugA: string;
  let slugB: string;
  let multi: { id: string; phone: string };
  let fresh: { id: string; phone: string };
  let racy: { id: string; phone: string };
  let bOnly: { id: string; phone: string };
  let roleUser: { id: string; phone: string };
  let roleMemberId: string;
  const createdTenantIds: string[] = [];
  const createdUserIds: string[] = [];

  async function createUser(name: string) {
    const user = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: `+5548${suffix()}${randomInt(0, 999)}`, name },
        select: { id: true, phone: true },
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function createTenant(prefix: string, status?: 'SUSPENDED') {
    const tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: {
          slug: `${prefix}-${suffix()}`,
          name: `Membership ${prefix}`,
          document: '12345678901',
          status,
        },
        select: { id: true, slug: true },
      }),
    );
    createdTenantIds.push(tenant.id);
    return tenant;
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    rls = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'mem-a');
    tenantB = await createTenantFixture(admin, 'mem-b');
    tenantSuspended = await createTenant('mem-susp', 'SUSPENDED');
    tenantRole = await createTenant('mem-role');

    const [fixtureA, fixtureB] = await Promise.all([
      admin.asPlatformAdmin((tx) =>
        tx.tenant.findUnique({ where: { id: tenantA.tenantId }, select: { slug: true } }),
      ),
      admin.asPlatformAdmin((tx) =>
        tx.tenant.findUnique({ where: { id: tenantB.tenantId }, select: { slug: true } }),
      ),
    ]);
    slugA = fixtureA!.slug;
    slugB = fixtureB!.slug;

    multi = await createUser('Pessoa Multi');
    fresh = await createUser('Pessoa Nova');
    racy = await createUser('Pessoa Corrida');
    bOnly = await createUser('Pessoa Só B');
    roleUser = await createUser('Papel Mutável');

    // A MESMA pessoa: OWNER no salão A, CUSTOMER no salão B.
    await admin.asPlatformAdmin(async (tx) => {
      await tx.tenantMember.create({
        data: { tenantId: tenantA.tenantId, userId: multi.id, role: 'OWNER' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantB.tenantId, userId: multi.id, role: 'CUSTOMER' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantB.tenantId, userId: bOnly.id, role: 'CUSTOMER' },
      });
      await tx.tenantMember.create({
        data: { tenantId: tenantSuspended.id, userId: multi.id, role: 'OWNER' },
      });
      const roleMember = await tx.tenantMember.create({
        data: { tenantId: tenantRole.id, userId: roleUser.id, role: 'OWNER' },
      });
      roleMemberId = roleMember.id;
    });
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of createdTenantIds) await deleteTenant(admin, tenantId);
      if (createdUserIds.length > 0) {
        await admin.asPlatformAdmin((tx) =>
          tx.user.deleteMany({ where: { id: { in: createdUserIds } } }),
        );
      }
      await admin.disconnect();
    }
    if (rls) await rls.disconnect();
  });

  beforeEach(() => {
    authState.headers = new Headers({ 'x-tenant-host': APP_HOST });
    authState.sessionCookie = null;
  });

  function useTenant(slug: string): void {
    authState.headers.set('x-tenant-slug', slug);
  }

  function useSession(userId: string, activeTenantId: string | null = null): void {
    authState.sessionCookie = createSessionToken({ userId, activeTenantId });
  }

  it('primeiro acesso provisiona CUSTOMER e a chamada seguinte é idempotente', async () => {
    const first = await ensureMembership(tenantA.tenantId, fresh.id);
    expect(first).toMatchObject({
      tenantId: tenantA.tenantId,
      userId: fresh.id,
      role: 'CUSTOMER',
    });

    const again = await ensureMembership(tenantA.tenantId, fresh.id);
    expect(again.id).toBe(first.id);

    const count = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.count({ where: { tenantId: tenantA.tenantId, userId: fresh.id } }),
    );
    expect(count).toBe(1);
  });

  it('não rebaixa papel preexistente: quem já é OWNER continua OWNER', async () => {
    await expect(ensureMembership(tenantA.tenantId, multi.id)).resolves.toMatchObject({
      role: 'OWNER',
    });
    await expect(ensureMembership(tenantB.tenantId, multi.id)).resolves.toMatchObject({
      role: 'CUSTOMER',
    });
  });

  it('primeiros acessos simultâneos criam exatamente um vínculo', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureMembership(tenantA.tenantId, racy.id)),
    );

    expect(new Set(results.map((member) => member.id)).size).toBe(1);
    const count = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.count({ where: { tenantId: tenantA.tenantId, userId: racy.id } }),
    );
    expect(count).toBe(1);
  });

  it('mesma pessoa: OWNER no salão A e CUSTOMER no B — cada rota enxerga só o seu papel e os seus dados', async () => {
    useTenant(slugA);
    useSession(multi.id, tenantA.tenantId);

    const contextA = await requireRole('OWNER');
    expect(contextA.role).toBe('OWNER');
    expect(contextA.tenant.id).toBe(tenantA.tenantId);

    // A RLS de verdade só é aplicada na role comum do helper: o client global
    // da aplicação conecta como superuser em desenvolvimento (ver db.ts).
    const bookingsA = await rls.forTenant(contextA.tenant.id, (tx) => tx.booking.findMany());
    expect(bookingsA.map((booking) => booking.id)).toEqual([tenantA.bookingId]);
    expect(bookingsA.some((booking) => booking.id === tenantB.bookingId)).toBe(false);

    // O token aponta para o salão A, mas a rota é do salão B: a rota manda.
    useTenant(slugB);
    await expect(requireRole('OWNER')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const contextB = await requireRole('CUSTOMER');
    expect(contextB.role).toBe('CUSTOMER');
    expect(contextB.tenant.id).toBe(tenantB.tenantId);

    const bookingsB = await rls.forTenant(contextB.tenant.id, (tx) => tx.booking.findMany());
    expect(bookingsB.map((booking) => booking.id)).toEqual([tenantB.bookingId]);
    expect(bookingsB.some((booking) => booking.id === tenantA.bookingId)).toBe(false);
  });

  it('troca de contexto: /painel passa a resolver o salão B com o papel de lá', async () => {
    useSession(multi.id, tenantA.tenantId);
    expect((await requireRole('OWNER')).tenant.id).toBe(tenantA.tenantId);

    const session = await switchActiveTenant(tenantB.tenantId);
    expect(session.activeTenantId).toBe(tenantB.tenantId);

    const switched = await requireRole('CUSTOMER');
    expect(switched.tenant.id).toBe(tenantB.tenantId);
    expect(switched.role).toBe('CUSTOMER');
    await expect(requireRole('OWNER')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('recusa troca para tenant em que a pessoa não é membro e preserva a sessão', async () => {
    useSession(bOnly.id, tenantB.tenantId);

    await expect(switchActiveTenant(tenantA.tenantId)).rejects.toBeInstanceOf(MembershipError);
    await expect(switchActiveTenant(tenantA.tenantId)).rejects.toMatchObject({
      code: 'NOT_A_MEMBER',
      status: 403,
    });
    expect(sessionPayload().activeTenantId).toBe(tenantB.tenantId);
  });

  it('recusa troca sem sessão (401)', async () => {
    await expect(switchActiveTenant(tenantA.tenantId)).rejects.toMatchObject({
      code: 'NO_SESSION',
      status: 401,
    });
  });

  it('recusa troca para tenant suspenso e preserva a sessão', async () => {
    useSession(multi.id, tenantA.tenantId);

    await expect(switchActiveTenant(tenantSuspended.id)).rejects.toBeInstanceOf(
      TenantUnavailableError,
    );
    expect(sessionPayload().activeTenantId).toBe(tenantA.tenantId);
  });

  it('papel é lido do banco a cada requisição: muda sem novo login e não vai para o token', async () => {
    useTenant(tenantRole.slug);
    useSession(roleUser.id, tenantRole.id);
    const tokenBefore = authState.sessionCookie;

    expect((await requireRole()).role).toBe('OWNER');

    await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.update({ where: { id: roleMemberId }, data: { role: 'STAFF' } }),
    );

    expect((await requireRole()).role).toBe('STAFF');
    expect(authState.sessionCookie).toBe(tokenBefore);
    expect(Object.keys(sessionPayload()).sort()).toEqual([
      'activeTenantId',
      'expiresAt',
      'issuedAt',
      'userId',
    ]);
    expect(JSON.stringify(sessionPayload())).not.toMatch(/OWNER|STAFF|CUSTOMER/);
  });

  it('listMyMemberships devolve só os vínculos da sessão', async () => {
    useSession(multi.id, tenantA.tenantId);

    const memberships = await listMyMemberships();
    expect(memberships).toHaveLength(3);
    expect(memberships).toEqual(
      expect.arrayContaining([
        { tenant: expect.objectContaining({ id: tenantA.tenantId }), role: 'OWNER' },
        { tenant: expect.objectContaining({ id: tenantB.tenantId }), role: 'CUSTOMER' },
        { tenant: expect.objectContaining({ id: tenantSuspended.id }), role: 'OWNER' },
      ]),
    );
    expect(memberships.map((membership) => membership.tenant.id)).not.toContain(tenantRole.id);

    // Outra pessoa do mesmo salão B não entra na lista de multi.
    useSession(bOnly.id, tenantB.tenantId);
    const otherMemberships = await listMyMemberships();
    expect(otherMemberships).toHaveLength(1);
    expect(otherMemberships[0]?.tenant.id).toBe(tenantB.tenantId);
    expect(otherMemberships[0]?.role).toBe('CUSTOMER');
  });

  it('listMyMemberships sem sessão é 401', async () => {
    await expect(listMyMemberships()).rejects.toMatchObject({ code: 'NO_SESSION', status: 401 });
  });

  it('getMembership não enxerga vínculo de outro tenant e não vaza a existência do usuário', async () => {
    // Mesmo sabendo o id/telefone da pessoa, o salão A só enxerga linhas do A.
    await expect(getMembership(tenantA.tenantId, bOnly.id)).resolves.toBeNull();

    const hiddenById = await rls.forTenant(tenantA.tenantId, (tx) =>
      tx.tenantMember.findMany({ where: { userId: bOnly.id } }),
    );
    expect(hiddenById).toHaveLength(0);

    const hiddenByPhone = await rls.forTenant(tenantA.tenantId, (tx) =>
      tx.tenantMember.findFirst({ where: { user: { phone: bOnly.phone } } }),
    );
    expect(hiddenByPhone).toBeNull();

    const visible = await rls.forTenant(tenantA.tenantId, (tx) => tx.tenantMember.findMany());
    expect(visible.every((member) => member.tenantId === tenantA.tenantId)).toBe(true);
    expect(visible.some((member) => member.userId === bOnly.id)).toBe(false);

    // Conhecendo a chave composta do vínculo no B, ainda assim nada aparece.
    const directHit = await rls.forTenant(tenantA.tenantId, (tx) =>
      tx.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: tenantB.tenantId, userId: bOnly.id } },
      }),
    );
    expect(directHit).toBeNull();
  });

  it('o salão A não escreve vínculo no salão B', async () => {
    let caught: unknown;
    try {
      await rls.forTenant(tenantA.tenantId, (tx) =>
        tx.tenantMember.create({
          data: { tenantId: tenantB.tenantId, userId: fresh.id, role: 'OWNER' },
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(postgresErrorCode(caught)).toBe('42501');

    await expect(
      rls.forTenant(tenantA.tenantId, (tx) =>
        tx.tenantMember.update({
          where: { id: tenantB.customerMemberId },
          data: { role: 'OWNER' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });

    const untouched = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantB.customerMemberId },
        select: { role: true },
      }),
    );
    expect(untouched?.role).toBe('CUSTOMER');
  });
});
