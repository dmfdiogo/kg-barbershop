import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { inviteStaff } from '@/lib/staffing/members';
import {
  assertCanAddAgenda,
  changePlan,
  getAgendaUsage,
  listActiveAgendas,
} from '@/lib/billing/limits';
import type { BillingPlanCode } from '@/lib/billing/plans';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Planos e limites no servidor (tarefa F7.0), com Postgres real e a role SEM
 * superuser (`kg_rls_app`). O que estes testes provam:
 *
 *   - chamar `inviteStaff` direto — fora da tela — esbarra no limite do plano;
 *   - o trial (sem `PlatformSub`) não limita;
 *   - downgrade que aperta o limite não aplica sem a decisão de quem desativar;
 *   - o uso e a desativação não atravessam tenants.
 */

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

describe('billing: planos e limites', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const tenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterAll(async () => {
    for (const tenantId of tenants) {
      await deleteTenant(admin, tenantId);
    }
    await scoped?.disconnect();
    await admin?.disconnect();
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const tenant = await createTenantFixture(admin, prefix);
    tenants.push(tenant.tenantId);
    return tenant;
  }

  async function setPlan(
    tenantId: string,
    plan: BillingPlanCode,
    status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' = 'ACTIVE',
  ): Promise<void> {
    await admin.asPlatformAdmin((tx) =>
      tx.platformSub.create({ data: { tenantId, plan, status } }),
    );
  }

  async function activeStaffCount(tenantId: string): Promise<number> {
    return scoped.forTenant(tenantId, (tx) =>
      tx.staffProfile.count({ where: { tenantId, active: true } }),
    );
  }

  async function countMembers(tenantId: string): Promise<number> {
    return admin.asPlatformAdmin((tx) =>
      tx.tenantMember.count({ where: { tenantId } }),
    );
  }

  it('chamada direta a inviteStaff respeita o limite do plano (Solo = 1 agenda)', async () => {
    const tenant = await makeTenant('limit-solo');
    await setPlan(tenant.tenantId, 'SOLO');

    // O fixture já nasce com 1 agenda ativa, que é o limite do Solo.
    const result = await scoped.forTenant(tenant.tenantId, (tx) =>
      inviteStaff(tx, tenant.tenantId, { name: 'Quinto Profissional', phone: randomPhone() }),
    );

    expect(result).toMatchObject({ ok: false, code: 'PLAN_LIMIT' });
    if (!result.ok) {
      expect(result.message).toContain('Solo');
      expect(result.planLimit?.usage.activeAgendas).toBe(1);
      expect(result.planLimit?.upgrade?.plan).toBe('EQUIPE');
    }

    // Nada foi criado: nem agenda, nem vínculo, nem usuário avulso.
    expect(await activeStaffCount(tenant.tenantId)).toBe(1);
    expect(await countMembers(tenant.tenantId)).toBe(3);
  });

  it('o upgrade libera a agenda e o convite volta a funcionar', async () => {
    const tenant = await makeTenant('limit-upgrade');
    await setPlan(tenant.tenantId, 'SOLO');

    const blocked = await scoped.forTenant(tenant.tenantId, (tx) =>
      inviteStaff(tx, tenant.tenantId, { name: 'Bloqueado', phone: randomPhone() }),
    );
    expect(blocked.ok).toBe(false);

    const upgraded = await scoped.forTenant(tenant.tenantId, (tx) =>
      changePlan(tx, tenant.tenantId, 'EQUIPE'),
    );
    expect(upgraded.ok).toBe(true);
    if (upgraded.ok) expect(upgraded.plan).toBe('EQUIPE');

    const allowed = await scoped.forTenant(tenant.tenantId, (tx) =>
      inviteStaff(tx, tenant.tenantId, { name: 'Permitido', phone: randomPhone() }),
    );
    expect(allowed.ok).toBe(true);
    expect(await activeStaffCount(tenant.tenantId)).toBe(2);
  });

  it('sem assinatura, o trial não limita agendas', async () => {
    const tenant = await makeTenant('limit-trial');

    const usage = await scoped.forTenant(tenant.tenantId, (tx) =>
      getAgendaUsage(tx, tenant.tenantId),
    );
    expect(usage).toMatchObject({ plan: null, planName: 'Trial', limit: null });

    const result = await scoped.forTenant(tenant.tenantId, (tx) =>
      inviteStaff(tx, tenant.tenantId, { name: 'Trial', phone: randomPhone() }),
    );
    expect(result.ok).toBe(true);
  });

  it('downgrade acima do limite não aplica sem decisão de quem desativar', async () => {
    const tenant = await makeTenant('limit-downgrade');
    await setPlan(tenant.tenantId, 'PRO');

    for (let index = 0; index < 2; index += 1) {
      const invited = await scoped.forTenant(tenant.tenantId, (tx) =>
        inviteStaff(tx, tenant.tenantId, { name: `Equipe ${index}`, phone: randomPhone() }),
      );
      expect(invited.ok).toBe(true);
    }
    expect(await activeStaffCount(tenant.tenantId)).toBe(3);

    // Sem decisão: recusa e não grava.
    const withoutDecision = await scoped.forTenant(tenant.tenantId, (tx) =>
      changePlan(tx, tenant.tenantId, 'SOLO'),
    );
    expect(withoutDecision).toMatchObject({
      ok: false,
      code: 'DOWNGRADE_REQUIRES_DECISION',
    });
    if (!withoutDecision.ok) {
      expect(withoutDecision.assessment.excess).toBe(2);
      expect(withoutDecision.assessment.agendas).toHaveLength(3);
    }

    const stillPro = await admin.asPlatformAdmin((tx) =>
      tx.platformSub.findUniqueOrThrow({
        where: { tenantId: tenant.tenantId },
        select: { plan: true },
      }),
    );
    expect(stillPro.plan).toBe('PRO');
    expect(await activeStaffCount(tenant.tenantId)).toBe(3);

    // Decisão insuficiente (1 de 2): recusa e não grava.
    const agendas = await scoped.forTenant(tenant.tenantId, (tx) =>
      listActiveAgendas(tx, tenant.tenantId),
    );
    const insufficient = await scoped.forTenant(tenant.tenantId, (tx) =>
      changePlan(tx, tenant.tenantId, 'SOLO', {
        deactivateStaffIds: [agendas[0]!.id],
      }),
    );
    expect(insufficient).toMatchObject({ ok: false, code: 'INVALID_DEACTIVATION' });
    expect(await activeStaffCount(tenant.tenantId)).toBe(3);

    // Decisão suficiente: aplica o plano e desativa exatamente o necessário.
    const enough = await scoped.forTenant(tenant.tenantId, (tx) =>
      changePlan(tx, tenant.tenantId, 'SOLO', {
        deactivateStaffIds: [agendas[0]!.id, agendas[1]!.id],
      }),
    );
    expect(enough.ok).toBe(true);
    if (enough.ok) expect(enough.deactivatedStaffIds).toHaveLength(2);

    const after = await admin.asPlatformAdmin((tx) =>
      tx.platformSub.findUniqueOrThrow({
        where: { tenantId: tenant.tenantId },
        select: { plan: true },
      }),
    );
    expect(after.plan).toBe('SOLO');
    expect(await activeStaffCount(tenant.tenantId)).toBe(1);
  });

  it('não vaza uso nem desativação entre tenants', async () => {
    const tenantA = await makeTenant('limit-iso-a');
    const tenantB = await makeTenant('limit-iso-b');
    await setPlan(tenantA.tenantId, 'PRO');
    await setPlan(tenantB.tenantId, 'SOLO');

    for (let index = 0; index < 2; index += 1) {
      await scoped.forTenant(tenantA.tenantId, (tx) =>
        inviteStaff(tx, tenantA.tenantId, { name: `A ${index}`, phone: randomPhone() }),
      );
    }

    const usageA = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getAgendaUsage(tx, tenantA.tenantId),
    );
    const usageB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      getAgendaUsage(tx, tenantB.tenantId),
    );
    expect(usageA.activeAgendas).toBe(3);
    expect(usageB.activeAgendas).toBe(1);

    const agendasA = await scoped.forTenant(tenantA.tenantId, (tx) =>
      listActiveAgendas(tx, tenantA.tenantId),
    );
    expect(agendasA.some((agenda) => agenda.id === tenantB.staffId)).toBe(false);

    // Tentar "resolver" o downgrade de A desativando a agenda de B: recusado e
    // B permanece intacto.
    const cross = await scoped.forTenant(tenantA.tenantId, (tx) =>
      changePlan(tx, tenantA.tenantId, 'SOLO', {
        deactivateStaffIds: [tenantB.staffId],
      }),
    );
    expect(cross).toMatchObject({ ok: false, code: 'INVALID_DEACTIVATION' });

    const staffB = await admin.asPlatformAdmin((tx) =>
      tx.staffProfile.findUniqueOrThrow({
        where: { id: tenantB.staffId },
        select: { active: true },
      }),
    );
    expect(staffB.active).toBe(true);

    // O portão de agenda de B conta só a agenda de B (Solo = 1) — as de A não
    // entram na conta.
    const decisionB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      assertCanAddAgenda(tx, tenantB.tenantId),
    );
    expect(decisionB.ok).toBe(false);
    if (!decisionB.ok) {
      expect(decisionB.usage.activeAgendas).toBe(1);
      expect(decisionB.usage.plan).toBe('SOLO');
    }
  });
});
