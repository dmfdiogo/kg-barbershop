import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '@/lib/auth/session';
import { resetMockBillingProvider } from '@/lib/billing/mock';
import { getLocalSubscription } from '@/lib/billing/subscription';
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
 * Tela de assinatura da plataforma (tarefa F8.0-B), com Postgres real e a role
 * SEM superuser (`kg_rls_app`):
 *
 *   - o portão de OWNER barra o Staff no layout E nas server actions;
 *   - a volta do Checkout sem webhook mostra "aguardando confirmação" e NÃO
 *     "ativa" (a assinatura só nasce no provedor);
 *   - downgrade que aperta o limite é recusado sem `deactivateStaffIds`
 *     suficiente, e a tela explica o excesso e quem desativar;
 *   - nada é gravado quando a troca é recusada.
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

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/painel/assinatura',
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import {
  cancelSubscriptionAction,
  changePlanAction,
  openPortalAction,
  startCheckoutAction,
} from '@/app/(dashboard)/painel/assinatura/actions';
import AssinaturaLayout from '@/app/(dashboard)/painel/assinatura/layout';
import AssinaturaPage from '@/app/(dashboard)/painel/assinatura/page';

function phone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

async function userIdOf(admin: TenantDb, memberId: string): Promise<string> {
  const member = await admin.asPlatformAdmin((tx) =>
    tx.tenantMember.findUnique({ where: { id: memberId }, select: { userId: true } }),
  );
  return member?.userId ?? '';
}

describe('tela de assinatura', () => {
  let admin: TenantDb;
  let scoped: TenantDb;

  let rbacTenant: TenantFixture;
  let rbacOwnerUserId: string;
  let rbacStaffUserId: string;

  let awaitTenant: TenantFixture;

  let downgradeTenant: TenantFixture;
  let downgradeOwnerUserId: string;
  const extraStaffNames = ['Ana Souza', 'Bia Lima'];

  async function renderPage(params: Record<string, string> = {}): Promise<string> {
    const element = await AssinaturaPage({ searchParams: Promise.resolve(params) });
    return renderToStaticMarkup(element);
  }

  function login(tenant: TenantFixture, userId: string): void {
    authState.sessionCookie = createSessionToken({
      userId,
      activeTenantId: tenant.tenantId,
    });
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    rbacTenant = await createTenantFixture(admin, 'assinatura-rbac');
    rbacOwnerUserId = await userIdOf(admin, rbacTenant.ownerMemberId);
    rbacStaffUserId = await userIdOf(admin, rbacTenant.staffMemberId);

    awaitTenant = await createTenantFixture(admin, 'assinatura-await');

    downgradeTenant = await createTenantFixture(admin, 'assinatura-downgrade');
    downgradeOwnerUserId = await userIdOf(admin, downgradeTenant.ownerMemberId);

    // Dois profissionais extras ativos no tenant do downgrade: com o do fixture
    // somam 3 agendas, e o Solo só comporta 1.
    await admin.asPlatformAdmin(async (tx) => {
      for (const name of extraStaffNames) {
        const user = await tx.user.create({ data: { phone: phone(), name } });
        const member = await tx.tenantMember.create({
          data: { tenantId: downgradeTenant.tenantId, userId: user.id, role: 'STAFF' },
        });
        await tx.staffProfile.create({
          data: { tenantId: downgradeTenant.tenantId, tenantMemberId: member.id },
        });
      }
      await tx.platformSub.create({
        data: {
          tenantId: downgradeTenant.tenantId,
          plan: 'PRO',
          status: 'ACTIVE',
          stripeSubscriptionId: `sub_test_${downgradeTenant.tenantId}`,
          stripeCustomerId: `cus_test_${downgradeTenant.tenantId}`,
        },
      });
    });
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (rbacTenant) await deleteTenant(admin, rbacTenant.tenantId);
      if (awaitTenant) await deleteTenant(admin, awaitTenant.tenantId);
      if (downgradeTenant) await deleteTenant(admin, downgradeTenant.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
    resetMockBillingProvider();
  });

  it('o dono acessa a tela; o Staff recebe o 404 do segmento', async () => {
    login(rbacTenant, rbacOwnerUserId);
    const html = renderToStaticMarkup(
      await AssinaturaLayout({ children: 'conteudo-de-assinatura' }),
    );
    expect(html).toContain('conteudo-de-assinatura');

    login(rbacTenant, rbacStaffUserId);
    await expect(AssinaturaLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a tela manda para a raiz', async () => {
    await expect(AssinaturaLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('as server actions que mexem em dinheiro recusam o Staff', async () => {
    login(rbacTenant, rbacStaffUserId);

    await expect(startCheckoutAction('SOLO')).resolves.toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    await expect(changePlanAction('PRO', [])).resolves.toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    await expect(cancelSubscriptionAction(true)).resolves.toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
    await expect(openPortalAction()).resolves.toMatchObject({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it('a trial por valor aparece com o consumo da lib/billing/trial', async () => {
    login(rbacTenant, rbacOwnerUserId);
    const html = await renderPage();

    expect(html).toContain('0 de 10 agendamentos gratuitos usados');
    expect(html).toContain('Período de teste');
    expect(html).toContain('Assinar Pro');
  });

  it('volta do Checkout sem webhook mostra aguardando confirmação, não ativa', async () => {
    login(awaitTenant, await userIdOf(admin, awaitTenant.ownerMemberId));

    const started = await startCheckoutAction('EQUIPE');
    expect(started.ok).toBe(true);
    if (started.ok) {
      // URL do provedor é absoluta; a tela apenas redireciona para lá.
      expect(started.url).toMatch(/^https?:\/\//);
    }

    // O que existe no banco é a INTENÇÃO do checkout, não uma assinatura:
    // sem `stripeSubscriptionId`, o webhook ainda não criou nada no provedor.
    const local = await getLocalSubscription(awaitTenant.tenantId);
    expect(local).toMatchObject({ plan: 'EQUIPE', status: 'TRIALING' });
    expect(local?.stripeSubscriptionId).toBeNull();

    const html = await renderPage();
    expect(html).toContain('Aguardando confirmação');
    expect(html).not.toContain('Plano atual');
    expect(html).not.toContain('Trocar cartão ou ver faturas');
  });

  it('downgrade que aperta o limite exige decisão e a tela explica', async () => {
    login(downgradeTenant, downgradeOwnerUserId);

    // Sem escolha nenhuma: recusa e não grava.
    const refused = await changePlanAction('SOLO', []);
    expect(refused).toMatchObject({ ok: false, code: 'DOWNGRADE_REQUIRES_DECISION' });
    if (!refused.ok) expect(refused.message).toMatch(/Desative 2/);

    // Escolha insuficiente (1 de 2): também recusa.
    const partial = await changePlanAction('SOLO', [downgradeTenant.staffId]);
    expect(partial).toMatchObject({ ok: false, code: 'INVALID_DEACTIVATION' });

    // Nada mudou: plano e profissionais intactos.
    const stillPro = await getLocalSubscription(downgradeTenant.tenantId);
    expect(stillPro?.plan).toBe('PRO');
    const activeCount = await scoped.forTenant(downgradeTenant.tenantId, (tx) =>
      tx.staffProfile.count({ where: { tenantId: downgradeTenant.tenantId, active: true } }),
    );
    expect(activeCount).toBe(3);

    // A tela do plano de destino mostra o excesso e a lista de quem desativar.
    const html = await renderPage({ plano: 'SOLO' });
    expect(html).toContain('O plano Solo permite 1 agenda ativa e o salão tem 3 ativa(s).');
    expect(html).toContain('Escolha 2 profissional(is) para desativar antes de aplicar.');
    expect(html).toContain(extraStaffNames[0]);
    expect(html).toContain(extraStaffNames[1]);
    expect(html).toContain('Confirmar downgrade');
    // O botão de confirmar só habilita com exatamente 2 selecionados.
    expect(html).toContain('Quem desativar (0/2)');
  });
});
