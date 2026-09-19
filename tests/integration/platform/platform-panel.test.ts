import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '@/lib/auth/session';
import { getPlatformOverview, listPlatformTenants } from '@/lib/platform/overview';
import { getTenantSupportContext } from '@/lib/platform/support';
import type { TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Painel do Super Admin (tarefa F7.3). Cobre os dois critérios de aceite da
 * tarefa no nível do dado (o portão de ROTA é provado em
 * `platform-layout.test.ts` e `gate-coverage.test.ts`):
 *
 *   1. Owner comum não acessa nada do painel — nem a lista, nem a ficha de um
 *      tenant, nem sequer descobre se um id existe. E não deixa rastro.
 *   2. Todo acesso de suporte a dado de tenant grava `AuditLog`, inclusive
 *      quando a ficha é reaberta. Id inexistente não audita (não há tenant para
 *      a FK) e devolve `null` para o 404 do segmento.
 *
 * ISOLAMENTO: como a ficha lê por `asPlatformAdmin()` (bypass de RLS), o filtro
 * por tenant é responsabilidade do código — por isso há teste com DOIS tenants
 * provando que a ficha de um nunca traz agendamento do outro.
 */

const authState = vi.hoisted(() => ({
  sessionCookie: null as string | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
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
}));

import PlataformaPage from '@/app/(platform)/plataforma/page';
import TenantSupportPage from '@/app/(platform)/plataforma/tenants/[tenantId]/page';

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

describe('painel do Super Admin', () => {
  let admin: TenantDb;
  let fixtureA: TenantFixture;
  let fixtureB: TenantFixture;
  let ownerUserId: string;
  let superUser: { id: string };

  function useSession(userId: string, activeTenantId?: string): void {
    authState.sessionCookie = createSessionToken({
      userId,
      ...(activeTenantId ? { activeTenantId } : {}),
    });
  }

  function auditRows(tenantId: string) {
    return admin.asPlatformAdmin((tx) =>
      tx.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    );
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixtureA = await createTenantFixture(admin, 'panel-a');
    fixtureB = await createTenantFixture(admin, 'panel-b');

    const ownerMember = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUniqueOrThrow({
        where: { id: fixtureA.ownerMemberId },
        select: { userId: true },
      }),
    );
    ownerUserId = ownerMember.userId;

    superUser = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: randomPhone(), name: 'Super Painel', isSuperAdmin: true },
        select: { id: true },
      }),
    );

    // Assinatura e subconta reais na ficha: EQUIPE ativa, KYC pendente.
    await admin.asPlatformAdmin(async (tx) => {
      await tx.platformSub.create({
        data: {
          tenantId: fixtureA.tenantId,
          plan: 'EQUIPE',
          status: 'ACTIVE',
          stripeCustomerId: 'cus_panel_a',
          stripeSubscriptionId: 'sub_panel_a',
        },
      });
      await tx.asaasAccount.create({
        data: {
          tenantId: fixtureA.tenantId,
          asaasAccountId: 'panel-asaas-a',
          walletId: 'panel-wallet-a',
          apiKeyEnc: 'enc-placeholder',
          pixKey: 'painel@exemplo.com',
          kycStatus: 'PENDING',
        },
      });
    });
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (fixtureA) await deleteTenant(admin, fixtureA.tenantId);
      if (fixtureB) await deleteTenant(admin, fixtureB.tenantId);
      if (superUser) {
        await admin.asPlatformAdmin((tx) => tx.user.delete({ where: { id: superUser.id } }));
      }
      await admin.disconnect();
    }
  });

  beforeEach(async () => {
    authState.sessionCookie = null;
    if (admin && fixtureA && fixtureB) {
      await admin.asPlatformAdmin((tx) =>
        tx.auditLog.deleteMany({
          where: { tenantId: { in: [fixtureA.tenantId, fixtureB.tenantId] } },
        }),
      );
    }
  });

  describe('owner comum', () => {
    it('não carrega a lista nem as métricas da plataforma', async () => {
      useSession(ownerUserId, fixtureA.tenantId);

      await expect(listPlatformTenants()).rejects.toMatchObject({
        name: 'AuthError',
        code: 'FORBIDDEN',
        status: 403,
      });
      await expect(getPlatformOverview()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('não abre a ficha de suporte de um tenant', async () => {
      useSession(ownerUserId, fixtureA.tenantId);

      await expect(getTenantSupportContext(fixtureA.tenantId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      expect(await auditRows(fixtureA.tenantId)).toHaveLength(0);
    });

    it('é negado antes de descobrir se um id existe', async () => {
      useSession(ownerUserId, fixtureA.tenantId);

      await expect(getTenantSupportContext('id-que-nao-existe')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('não renderiza as páginas de (platform) mesmo sem o layout', async () => {
      useSession(ownerUserId, fixtureA.tenantId);

      await expect(PlataformaPage()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        TenantSupportPage({ params: Promise.resolve({ tenantId: fixtureA.tenantId }) }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(await auditRows(fixtureA.tenantId)).toHaveLength(0);
    });
  });

  describe('Super Admin', () => {
    it('lista tenants com plano, uso e KYC', async () => {
      useSession(superUser.id);

      const { tenants, metrics } = await getPlatformOverview();
      const rowA = tenants.find((tenant) => tenant.id === fixtureA.tenantId);

      expect(rowA).toMatchObject({
        id: fixtureA.tenantId,
        plan: 'EQUIPE',
        subscriptionStatus: 'ACTIVE',
        kycStatus: 'PENDING',
        activeAgendas: 1,
      });
      expect(metrics.totalTenants).toBe(tenants.length);
      // A mensalidade EQUIPE (R$ 79,90) está no MRR.
      expect(metrics.mrrCents).toBeGreaterThanOrEqual(7990);
    });

    it('registra o acesso de suporte em AuditLog, uma linha por acesso', async () => {
      useSession(superUser.id);

      const first = await getTenantSupportContext(fixtureA.tenantId);
      expect(first?.tenant.id).toBe(fixtureA.tenantId);
      await getTenantSupportContext(fixtureA.tenantId);

      const rows = await auditRows(fixtureA.tenantId);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        tenantId: fixtureA.tenantId,
        actorId: superUser.id,
        action: 'tenant.support_access',
        entity: 'Tenant',
        entityId: fixtureA.tenantId,
      });
    });

    it('a ficha traz assinatura, conta de recebimento e uso sem vazar a chave do Asaas', async () => {
      useSession(superUser.id);

      const context = await getTenantSupportContext(fixtureA.tenantId);
      expect(context).not.toBeNull();
      expect(context?.subscription).toMatchObject({ plan: 'EQUIPE', status: 'ACTIVE' });
      expect(context?.receivingAccount).toMatchObject({
        kycStatus: 'PENDING',
        asaasAccountId: 'panel-asaas-a',
      });
      // A credencial da subconta não existe em nenhum campo do contexto.
      expect(JSON.stringify(context)).not.toContain('enc-placeholder');
      expect(context?.usage.activeAgendas).toBe(1);
    });

    it('não vaza agendamento de outro tenant (bypass de RLS filtra por tenant)', async () => {
      useSession(superUser.id);

      const contextA = await getTenantSupportContext(fixtureA.tenantId);
      const contextB = await getTenantSupportContext(fixtureB.tenantId);

      const idsA = contextA?.recentBookings.map((booking) => booking.id) ?? [];
      const idsB = contextB?.recentBookings.map((booking) => booking.id) ?? [];

      expect(idsA).toContain(fixtureA.bookingId);
      expect(idsA).not.toContain(fixtureB.bookingId);
      expect(idsB).toContain(fixtureB.bookingId);
      expect(idsB).not.toContain(fixtureA.bookingId);
    });

    it('id inexistente devolve null e não deixa linha (sem tenant para a FK)', async () => {
      useSession(superUser.id);

      await expect(getTenantSupportContext('id-que-nao-existe')).resolves.toBeNull();
    });
  });
});
