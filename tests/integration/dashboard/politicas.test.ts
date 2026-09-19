import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import {
  canCustomerCancel,
  loadPortalSettings,
  loadTenantPolicies,
} from '@/app/(dashboard)/painel/configuracoes/service';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Políticas e endereço do portal (tarefa F2.4), com Postgres real e a role SEM
 * superuser (`kg_rls_app`), para que a RLS valha:
 *
 *   - alterar a janela de cancelamento muda o que o DOMÍNIO lê;
 *   - slug reservado e slug já usado por outro tenant são recusados;
 *   - domínio próprio exige o plano Pro;
 *   - isolamento entre tenants (o tenant vem da sessão, nunca do formulário);
 *   - o portão da tela barra o Staff e libera o dono.
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
  usePathname: () => '/painel/configuracoes',
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

import {
  savePoliciesAction,
  savePortalAddressAction,
} from '@/app/(dashboard)/painel/configuracoes/actions';
import ConfiguracoesLayout from '@/app/(dashboard)/painel/configuracoes/layout';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const HOUR = 3_600_000;

function at(offsetHours: number): Date {
  return new Date(NOW.getTime() + offsetHours * HOUR);
}

describe('configurações do estabelecimento', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ownerUserIdA: string;
  let staffUserIdA: string;
  let slugB: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'config-a');
    tenantB = await createTenantFixture(admin, 'config-b');

    const [owner, staff, b] = await admin.asPlatformAdmin((tx) =>
      Promise.all([
        tx.tenantMember.findUnique({
          where: { id: tenantA.ownerMemberId },
          select: { userId: true },
        }),
        tx.tenantMember.findUnique({
          where: { id: tenantA.staffMemberId },
          select: { userId: true },
        }),
        tx.tenant.findUniqueOrThrow({
          where: { id: tenantB.tenantId },
          select: { slug: true },
        }),
      ]),
    );
    ownerUserIdA = owner?.userId ?? '';
    staffUserIdA = staff?.userId ?? '';
    slugB = b.slug;
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.tenantId);
      if (tenantB) await deleteTenant(admin, tenantB.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  function asOwner(): void {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserIdA,
      activeTenantId: tenantA.tenantId,
    });
  }

  it('mudar a janela de cancelamento muda o que o domínio lê', async () => {
    // Padrão do schema: 24h. Um atendimento em 1h está DENTRO da janela proibida.
    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        canCustomerCancel(tx, tenantA.tenantId, at(1), NOW),
      ),
    ).toBe(false);
    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        canCustomerCancel(tx, tenantA.tenantId, at(48), NOW),
      ),
    ).toBe(true);

    asOwner();
    const saved = await savePoliciesAction({
      cancellationWindowHours: '0',
      minAdvanceMinutes: '0',
      maxAdvanceMinutes: '',
      noShowPolicyText: '  Faltas podem reter o sinal.  ',
    });
    expect(saved.ok).toBe(true);

    // Janela zero: cancelar em cima da hora passa a ser permitido.
    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        canCustomerCancel(tx, tenantA.tenantId, at(1), NOW),
      ),
    ).toBe(true);

    const policies = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadTenantPolicies(tx, tenantA.tenantId),
    );
    expect(policies).toEqual({
      cancellationWindowHours: 0,
      minAdvanceMinutes: 0,
      maxAdvanceMinutes: null,
      noShowPolicyText: 'Faltas podem reter o sinal.',
    });
  });

  it('janela maior volta a bloquear o cancelamento próximo', async () => {
    asOwner();
    await savePoliciesAction({
      cancellationWindowHours: '72',
      minAdvanceMinutes: '0',
      maxAdvanceMinutes: '',
      noShowPolicyText: '',
    });

    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        canCustomerCancel(tx, tenantA.tenantId, at(48), NOW),
      ),
    ).toBe(false);
    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        canCustomerCancel(tx, tenantA.tenantId, at(100), NOW),
      ),
    ).toBe(true);
  });

  it('recusa slug reservado e slug em uso por outro tenant', async () => {
    asOwner();

    const reserved = await savePortalAddressAction({ slug: 'painel', customDomain: null });
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) {
      expect(reserved.code).toBe('INVALID');
      if (reserved.code === 'INVALID') expect(reserved.fieldErrors.slug).toMatch(/reservado/i);
    }

    const taken = await savePortalAddressAction({ slug: slugB, customDomain: null });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.code).toBe('SLUG_TAKEN');

    // O outro tenant permanece intacto.
    const b = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantB.tenantId }, select: { slug: true } }),
    );
    expect(b.slug).toBe(slugB);
  });

  it('salva um endereço livre e apenas o tenant da sessão muda', async () => {
    asOwner();
    const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
    const slug = `bella-${suffix}`;

    const result = await savePortalAddressAction({ slug: `  ${slug.toUpperCase()}  `, customDomain: null });
    expect(result.ok).toBe(true);

    const a = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantA.tenantId }, select: { slug: true } }),
    );
    expect(a.slug).toBe(slug);
  });

  it('domínio próprio é recusado fora do plano Pro e liberado no Pro', async () => {
    asOwner();
    const suffix = randomInt(0, 999_999).toString().padStart(6, '0');

    const withoutPro = await savePortalAddressAction({
      slug: `portal-${suffix}`,
      customDomain: `www.portal-${suffix}.com.br`,
    });
    expect(withoutPro.ok).toBe(false);
    if (!withoutPro.ok) expect(withoutPro.code).toBe('PRO_REQUIRED');

    await admin.asPlatformAdmin((tx) =>
      tx.platformSub.create({
        data: { tenantId: tenantA.tenantId, plan: 'PRO', status: 'ACTIVE' },
      }),
    );

    const withPro = await savePortalAddressAction({
      slug: `portal-${suffix}`,
      customDomain: `www.portal-${suffix}.com.br`,
    });
    expect(withPro.ok).toBe(true);

    const settings = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadPortalSettings(tx, tenantA.tenantId),
    );
    expect(settings.isPro).toBe(true);
    expect(settings.customDomain).toBe(`www.portal-${suffix}.com.br`);
  });

  it('o dono acessa a tela; o Staff recebe o 404 do segmento', async () => {
    asOwner();
    const html = renderToStaticMarkup(
      await ConfiguracoesLayout({ children: 'conteudo-de-configuracoes' }),
    );
    expect(html).toContain('conteudo-de-configuracoes');

    authState.sessionCookie = createSessionToken({
      userId: staffUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    await expect(ConfiguracoesLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, manda para a raiz', async () => {
    await expect(ConfiguracoesLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
