import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import { loadOnboarding } from '@/app/(dashboard)/painel/onboarding/service';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Onboarding guiado (tarefa F2.5), com Postgres real e role SEM superuser:
 *
 *   - o progresso é explícito e retoma no passo certo depois de abandonar;
 *   - o estabelecimento grava nome/documento no `Tenant` e a chave Pix com
 *     estado `AWAITING_ACTIVATION` (a subconta é da F4);
 *   - o endereço reusa a action da F2.4: slug reservado continua recusado;
 *   - um tenant não lê nem escreve o progresso do outro;
 *   - o portão barra o Staff e manda quem não tem sessão para a raiz.
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
  usePathname: () => '/painel/onboarding',
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

import {
  completeOnboardingStepAction,
  saveEstablishmentAction,
  saveOnboardingPortalAction,
} from '@/app/(dashboard)/painel/onboarding/actions';
import OnboardingLayout from '@/app/(dashboard)/painel/onboarding/layout';

describe('onboarding guiado', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ownerUserIdA: string;
  let staffUserIdA: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'onboarding-a');
    tenantB = await createTenantFixture(admin, 'onboarding-b');

    const owner = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantA.ownerMemberId },
        select: { userId: true },
      }),
    );
    const staff = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantA.staffMemberId },
        select: { userId: true },
      }),
    );
    ownerUserIdA = owner?.userId ?? '';
    staffUserIdA = staff?.userId ?? '';
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

  it('sem progresso, começa no estabelecimento', async () => {
    const view = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadOnboarding(tx, tenantA.tenantId),
    );
    expect(view.completedSteps).toEqual([]);
    expect(view.currentStep).toBe('ESTABLISHMENT');
  });

  it('salva o estabelecimento, a chave Pix e cria o perfil do dono', async () => {
    asOwner();
    const before = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantA.tenantId }, select: { slug: true } }),
    );

    const result = await saveEstablishmentAction({
      name: '  Onboarding A  ',
      document: '12.345.678/0001-90',
      pixKey: 'chave-pix-a',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.onboarding.currentStep).toBe('HOURS');
    expect(result.onboarding.completedSteps).toContain('ESTABLISHMENT');

    const tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantA.tenantId } }),
    );
    expect(tenant.name).toBe('Onboarding A');
    expect(tenant.document).toBe('12345678000190');

    const progress = await admin.asPlatformAdmin((tx) =>
      tx.onboardingProgress.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(progress.pixKey).toBe('chave-pix-a');
    expect(progress.payoutStatus).toBe('AWAITING_ACTIVATION');

    const ownerProfile = await admin.asPlatformAdmin((tx) =>
      tx.staffProfile.findFirst({
        where: { tenantId: tenantA.tenantId, tenantMemberId: tenantA.ownerMemberId },
        select: { id: true },
      }),
    );
    expect(ownerProfile).not.toBeNull();

    // O vizinho não foi tocado.
    const bTenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantB.tenantId }, select: { name: true } }),
    );
    expect(bTenant.name).not.toBe('Onboarding A');
    expect(before.slug).toBeTruthy();
  });

  it('retoma no primeiro passo em falta depois de abandonar', async () => {
    asOwner();
    await completeOnboardingStepAction('HOURS');

    const view = await admin.asPlatformAdmin((tx) =>
      tx.onboardingProgress.findUniqueOrThrow({ where: { tenantId: tenantA.tenantId } }),
    );
    expect(view.completedSteps).toEqual(['ESTABLISHMENT', 'HOURS']);

    const loaded = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadOnboarding(tx, tenantA.tenantId),
    );
    expect(loaded.currentStep).toBe('SERVICE');
  });

  it('reusa a action da F2.4 no endereço e recusa slug reservado', async () => {
    asOwner();

    const reserved = await saveOnboardingPortalAction({ slug: 'painel', customDomain: null });
    expect(reserved.ok).toBe(false);
    if (!reserved.ok) expect(reserved.code).toBe('INVALID');

    const stillOpen = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadOnboarding(tx, tenantA.tenantId),
    );
    expect(stillOpen.completedSteps).not.toContain('PORTAL');

    // Fecha o passo do serviço (o caminho passaria pela action da F2.1; aqui o
    // alvo é o encadeamento dos passos, não o formulário).
    await completeOnboardingStepAction('SERVICE');

    const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
    const slug = `onboarding-${suffix}`;
    const saved = await saveOnboardingPortalAction({ slug, customDomain: null });
    expect(saved.ok).toBe(true);

    const done = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadOnboarding(tx, tenantA.tenantId),
    );
    expect(done.completedSteps).toContain('PORTAL');
    expect(done.currentStep).toBeNull();
  });

  it('não vaza o progresso de um tenant para o outro', async () => {
    await admin.asPlatformAdmin((tx) =>
      tx.onboardingProgress.upsert({
        where: { tenantId: tenantB.tenantId },
        create: { tenantId: tenantB.tenantId, completedSteps: [], pixKey: 'chave-pix-b' },
        update: { pixKey: 'chave-pix-b' },
      }),
    );

    const fromB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      tx.onboardingProgress.findMany({ where: { tenantId: tenantB.tenantId } }),
    );
    expect(fromB).toHaveLength(1);
    expect(fromB[0]?.pixKey).toBe('chave-pix-b');

    const fromA = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.onboardingProgress.findMany(),
    );
    expect(fromA.every((row) => row.tenantId === tenantA.tenantId)).toBe(true);
    expect(fromA.some((row) => row.pixKey === 'chave-pix-b')).toBe(false);
  });

  it('o dono acessa a tela; o Staff recebe o 404 do segmento', async () => {
    asOwner();
    const html = renderToStaticMarkup(
      await OnboardingLayout({ children: 'conteudo-onboarding' }),
    );
    expect(html).toContain('conteudo-onboarding');

    authState.sessionCookie = createSessionToken({
      userId: staffUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    await expect(OnboardingLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, manda para a raiz', async () => {
    await expect(OnboardingLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
