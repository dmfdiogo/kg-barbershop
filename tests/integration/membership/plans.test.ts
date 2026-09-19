import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import {
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  setPlanActive,
  updatePlan,
  validateMembershipPlanForm,
  type ValidatedMembershipPlan,
} from '@/lib/membership/plans';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Planos e benefícios do clube (tarefa F5.0), contra Postgres real e a role SEM
 * superuser (`kg_rls_app`), para a RLS valer de fato. Prova os dois critérios de
 * pronto da tarefa:
 *
 *   1. reajustar o plano NÃO altera a assinatura vigente — o preço contratado
 *      (`Membership.contractedPriceCents`) fica onde estava;
 *   2. benefício só aponta para serviço do PRÓPRIO tenant, e um plano de outro
 *      salão é invisível e intocável.
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
  usePathname: () => '/painel/clube',
}));

import ClubeLayout from '@/app/(dashboard)/painel/clube/layout';

function planInput(overrides: Partial<ValidatedMembershipPlan> = {}): ValidatedMembershipPlan {
  return {
    name: 'Clube mensal',
    priceCents: 7900,
    cycle: 'MONTHLY',
    active: true,
    benefits: [],
    ...overrides,
  };
}

describe('planos do clube', () => {
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

    tenantA = await createTenantFixture(admin, 'clube-a');
    tenantB = await createTenantFixture(admin, 'clube-b');

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

  it('reajustar o plano não altera a assinatura vigente', async () => {
    const plan = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createPlan(
        tx,
        tenantA.tenantId,
        planInput({
          name: 'Clube com preço travado',
          priceCents: 7900,
          benefits: [{ serviceId: tenantA.serviceId, quantityPerCycle: 2 }],
        }),
      ),
    );
    expect(plan.priceCents).toBe(7900);

    // Assinante antigo: contratou por R$ 69,00 antes do reajuste.
    const membership = await admin.asPlatformAdmin((tx) =>
      tx.membership.create({
        data: {
          tenantId: tenantA.tenantId,
          customerId: tenantA.customerMemberId,
          planId: plan.id,
          status: 'ACTIVE',
          contractedPriceCents: 6900,
        },
        select: { id: true },
      }),
    );

    const updated = await scoped.forTenant(tenantA.tenantId, (tx) =>
      updatePlan(
        tx,
        tenantA.tenantId,
        plan.id,
        planInput({
          name: 'Clube com preço travado',
          priceCents: 8900,
          benefits: [{ serviceId: tenantA.serviceId, quantityPerCycle: 2 }],
        }),
      ),
    );
    expect(updated?.priceCents).toBe(8900);

    const persisted = await admin.asPlatformAdmin((tx) =>
      tx.membership.findUnique({
        where: { id: membership.id },
        select: { contractedPriceCents: true, planId: true },
      }),
    );
    expect(persisted?.contractedPriceCents).toBe(6900);
    expect(persisted?.planId).toBe(plan.id);
  });

  it('benefício só vincula serviço do próprio tenant', async () => {
    const plan = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createPlan(
        tx,
        tenantA.tenantId,
        planInput({
          name: 'Plano com serviço alheio',
          benefits: [
            { serviceId: tenantA.serviceId, quantityPerCycle: 1 },
            { serviceId: tenantB.serviceId, quantityPerCycle: 1 },
          ],
        }),
      ),
    );

    expect(plan.benefits.map((benefit) => benefit.serviceId)).toEqual([tenantA.serviceId]);

    // Nem vínculo escondido: a tabela não tem nenhuma linha apontando para o B.
    const crossLinks = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.membershipBenefit.findMany({
        where: { tenantId: tenantA.tenantId, serviceId: tenantB.serviceId },
        select: { id: true },
      }),
    );
    expect(crossLinks).toEqual([]);

    // A validação que a action usa também recusa o serviço alheio.
    const validation = validateMembershipPlanForm(
      {
        name: 'Plano',
        price: '79,00',
        cycle: 'MONTHLY',
        active: true,
        benefits: [{ serviceId: tenantB.serviceId, quantityPerCycle: '1' }],
      },
      new Set([tenantA.serviceId]),
    );
    expect(validation.ok).toBe(false);
  });

  it('A não lê nem altera plano de B (isolamento + RLS)', async () => {
    const planB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      createPlan(tx, tenantB.tenantId, planInput({ name: 'Plano do B' })),
    );

    const mine = await scoped.forTenant(tenantA.tenantId, (tx) =>
      listPlans(tx, tenantA.tenantId),
    );
    expect(mine.some((plan) => plan.id === planB.id)).toBe(false);

    // Sem `tenantId` explícito, a RLS sozinha já filtra o outro tenant.
    const rlsOnly = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.membershipPlan.findMany({ select: { id: true } }),
    );
    expect(rlsOnly.some((row) => row.id === planB.id)).toBe(false);

    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) => getPlan(tx, tenantA.tenantId, planB.id)),
    ).toBeNull();

    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        updatePlan(tx, tenantA.tenantId, planB.id, planInput({ name: 'Invadido' })),
      ),
    ).toBeNull();

    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        setPlanActive(tx, tenantA.tenantId, planB.id, false),
      ),
    ).toBe(false);

    expect(
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        deletePlan(tx, tenantA.tenantId, planB.id),
      ),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('plano com assinante não é excluído: recusa e preserva o histórico', async () => {
    const plan = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createPlan(tx, tenantA.tenantId, planInput({ name: 'Plano com assinante' })),
    );

    await admin.asPlatformAdmin((tx) =>
      tx.membership.create({
        data: {
          tenantId: tenantA.tenantId,
          customerId: tenantA.customerMemberId,
          planId: plan.id,
          status: 'ACTIVE',
          contractedPriceCents: plan.priceCents,
        },
      }),
    );

    const refusal = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deletePlan(tx, tenantA.tenantId, plan.id),
    );
    expect(refusal).toMatchObject({ ok: false, code: 'HAS_MEMBERSHIPS', memberships: 1 });

    const stillThere = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getPlan(tx, tenantA.tenantId, plan.id),
    );
    expect(stillThere).not.toBeNull();
  });

  it('plano sem assinante é excluído', async () => {
    const plan = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createPlan(tx, tenantA.tenantId, planInput({ name: 'Plano sem assinante' })),
    );

    const deleted = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deletePlan(tx, tenantA.tenantId, plan.id),
    );
    expect(deleted).toEqual({ ok: true });

    const gone = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getPlan(tx, tenantA.tenantId, plan.id),
    );
    expect(gone).toBeNull();
  });

  it('o dono acessa a tela do clube; o Staff recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    const html = renderToStaticMarkup(await ClubeLayout({ children: 'conteudo-do-clube' }));
    expect(html).toContain('conteudo-do-clube');

    authState.sessionCookie = createSessionToken({
      userId: staffUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    await expect(ClubeLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a tela do clube manda para a raiz', async () => {
    await expect(ClubeLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
