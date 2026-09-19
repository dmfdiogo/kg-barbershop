// @vitest-environment node
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadClubReport } from '@/app/(dashboard)/painel/clube/relatorios/_lib/reports';
import {
  loadCustomerClub,
  type CustomerClubContext,
} from '@/app/[slug]/(portal)/clube/_lib/club';
import { CREDIT_REASON } from '@/lib/membership/credits';
import type { MembershipCycle } from '@/lib/membership/plans';
import { cancelMembership, type MembershipStatus } from '@/lib/membership/subscription';
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
 * Visões do clube (tarefa F5.3), contra Postgres real e a role SEM superuser
 * (`kg_rls_app`), para a RLS valer de fato. Prova os critérios de pronto da
 * tarefa:
 *
 *   1. assinante do tenant A é invisível no painel do tenant B;
 *   2. cliente A1 não vê a assinatura do cliente A2 do MESMO salão, nem no
 *      painel do dono nem na própria tela;
 *   3. o saldo exibido é a SOMA do ledger append-only, não um contador paralelo;
 *   4. o MRR lê o preço CONTRATADO (6900), nunca o preço corrente do plano
 *      (7900) — o caso do seed — e normaliza ciclos diferentes para o mês.
 */

describe('visões do clube', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const tenantId of createdTenants) await deleteTenant(admin, tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  async function freshTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  async function createCustomerMember(tenantId: string, name: string): Promise<string> {
    return admin.asPlatformAdmin(async (tx) => {
      const phone = `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
      const user = await tx.user.create({ data: { phone, name } });
      const member = await tx.tenantMember.create({
        data: { tenantId, userId: user.id, role: 'CUSTOMER' },
      });
      return member.id;
    });
  }

  interface SeedMembershipOptions {
    customerMemberId: string;
    planName: string;
    planPriceCents: number;
    contractedPriceCents: number;
    cycle?: MembershipCycle;
    status?: MembershipStatus;
    benefitServiceId?: string;
    benefitQuantity?: number;
    ledger?: { serviceId: string; delta: number; reason: string }[];
  }

  async function seedMembership(
    tenantId: string,
    options: SeedMembershipOptions,
  ): Promise<{ planId: string; membershipId: string }> {
    return admin.asPlatformAdmin(async (tx) => {
      const plan = await tx.membershipPlan.create({
        data: {
          tenantId,
          name: options.planName,
          priceCents: options.planPriceCents,
          cycle: options.cycle ?? 'MONTHLY',
        },
      });

      if (options.benefitServiceId) {
        await tx.membershipBenefit.create({
          data: {
            tenantId,
            planId: plan.id,
            serviceId: options.benefitServiceId,
            quantityPerCycle: options.benefitQuantity ?? 1,
          },
        });
      }

      const membership = await tx.membership.create({
        data: {
          tenantId,
          customerId: options.customerMemberId,
          planId: plan.id,
          status: options.status ?? 'ACTIVE',
          contractedPriceCents: options.contractedPriceCents,
          currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
        },
      });

      if (options.ledger && options.ledger.length > 0) {
        await tx.creditLedger.createMany({
          data: options.ledger.map((entry) => ({
            tenantId,
            membershipId: membership.id,
            serviceId: entry.serviceId,
            delta: entry.delta,
            reason: entry.reason,
          })),
        });
      }

      return { planId: plan.id, membershipId: membership.id };
    });
  }

  function clubContext(tenantId: string, timezone = 'America/Sao_Paulo'): CustomerClubContext {
    return {
      tenant: { id: tenantId, timezone },
      forTenant: (fn) => scoped.forTenant(tenantId, fn),
    };
  }

  it('o dono do tenant B não vê o assinante do tenant A', async () => {
    const tenantA = await freshTenant('views-a');
    const tenantB = await freshTenant('views-b');

    const seededA = await seedMembership(tenantA.tenantId, {
      customerMemberId: tenantA.customerMemberId,
      planName: 'Clube A',
      planPriceCents: 7900,
      contractedPriceCents: 6900,
    });
    const seededB = await seedMembership(tenantB.tenantId, {
      customerMemberId: tenantB.customerMemberId,
      planName: 'Clube B',
      planPriceCents: 9900,
      contractedPriceCents: 9900,
    });

    const reportA = await scoped.forTenant(tenantA.tenantId, (tx) =>
      loadClubReport(tx, tenantA.tenantId),
    );
    const reportB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      loadClubReport(tx, tenantB.tenantId),
    );

    expect(reportA.subscribers.map((row) => row.membershipId)).toContain(seededA.membershipId);
    expect(reportA.subscribers.map((row) => row.membershipId)).not.toContain(
      seededB.membershipId,
    );
    expect(reportB.subscribers.map((row) => row.membershipId)).toContain(seededB.membershipId);
    expect(reportB.subscribers.map((row) => row.membershipId)).not.toContain(
      seededA.membershipId,
    );
  });

  it('o MRR usa o preço contratado (6900), não o preço do plano (7900)', async () => {
    const tenant = await freshTenant('views-mrr');
    await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Clube reajustado',
      planPriceCents: 7900,
      contractedPriceCents: 6900,
    });

    const report = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadClubReport(tx, tenant.tenantId),
    );

    expect(report.activeSubscribers).toBe(1);
    expect(report.mrrCents).toBe(6900);
    expect(report.mrrCents).not.toBe(7900);
  });

  it('normaliza MONTHLY e YEARLY no MRR do clube', async () => {
    const tenant = await freshTenant('views-mixed');
    const secondCustomer = await createCustomerMember(tenant.tenantId, 'Segundo cliente');

    await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Mensal',
      planPriceCents: 6900,
      contractedPriceCents: 6900,
      cycle: 'MONTHLY',
    });
    await seedMembership(tenant.tenantId, {
      customerMemberId: secondCustomer,
      planName: 'Anual',
      planPriceCents: 120000,
      contractedPriceCents: 120000,
      cycle: 'YEARLY',
    });

    const report = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadClubReport(tx, tenant.tenantId),
    );

    // (69,00×12 + 1200,00) / 12 = 169,00.
    expect(report.mrrCents).toBe(16900);
    expect(report.activeSubscribers).toBe(2);
  });

  it('PAST_DUE é inadimplente e fica fora do MRR', async () => {
    const tenant = await freshTenant('views-pastdue');
    await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Em atraso',
      planPriceCents: 9900,
      contractedPriceCents: 9900,
      status: 'PAST_DUE',
    });

    const report = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadClubReport(tx, tenant.tenantId),
    );

    expect(report.pastDueSubscribers).toBe(1);
    expect(report.activeSubscribers).toBe(0);
    expect(report.mrrCents).toBe(0);
  });

  it('consolida o consumo por serviço a partir do ledger', async () => {
    const tenant = await freshTenant('views-consumo');
    await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Com consumo',
      planPriceCents: 6900,
      contractedPriceCents: 6900,
      ledger: [
        { serviceId: tenant.serviceId, delta: 2, reason: CREDIT_REASON.cycleGrant },
        { serviceId: tenant.serviceId, delta: -1, reason: CREDIT_REASON.bookingConsumed },
      ],
    });

    const report = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadClubReport(tx, tenant.tenantId),
    );

    const row = report.consumption.find((entry) => entry.serviceId === tenant.serviceId);
    expect(row).toBeDefined();
    expect(row?.serviceName).toBe('Corte');
    expect(row?.consumedCredits).toBe(1);
    expect(row?.outstandingCredits).toBe(1);
  });

  it('o cliente A1 não vê a assinatura do cliente A2 do mesmo salão', async () => {
    const tenant = await freshTenant('views-clientes');
    const secondCustomer = await createCustomerMember(tenant.tenantId, 'Cliente dois');

    const seededA1 = await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Clube A1',
      planPriceCents: 6900,
      contractedPriceCents: 6900,
    });
    const seededA2 = await seedMembership(tenant.tenantId, {
      customerMemberId: secondCustomer,
      planName: 'Clube A2',
      planPriceCents: 9900,
      contractedPriceCents: 9900,
    });

    const forA1 = await loadCustomerClub(clubContext(tenant.tenantId), tenant.customerMemberId);
    const forA2 = await loadCustomerClub(clubContext(tenant.tenantId), secondCustomer);

    expect(forA1.memberships.map((row) => row.id)).toEqual([seededA1.membershipId]);
    expect(forA1.memberships.map((row) => row.id)).not.toContain(seededA2.membershipId);
    expect(forA2.memberships.map((row) => row.id)).toEqual([seededA2.membershipId]);
  });

  it('o saldo exibido é a soma do ledger e muda quando o ledger muda', async () => {
    const tenant = await freshTenant('views-saldo');
    const seeded = await seedMembership(tenant.tenantId, {
      customerMemberId: tenant.customerMemberId,
      planName: 'Com créditos',
      planPriceCents: 6900,
      contractedPriceCents: 6900,
      benefitServiceId: tenant.serviceId,
      benefitQuantity: 3,
      ledger: [
        { serviceId: tenant.serviceId, delta: 2, reason: CREDIT_REASON.cycleGrant },
        { serviceId: tenant.serviceId, delta: -1, reason: CREDIT_REASON.bookingConsumed },
      ],
    });

    const before = await loadCustomerClub(clubContext(tenant.tenantId), tenant.customerMemberId);
    const beforeBalance = before.memberships[0]?.benefits.find(
      (benefit) => benefit.serviceId === tenant.serviceId,
    );
    expect(beforeBalance?.balance).toBe(1);
    expect(beforeBalance?.quantityPerCycle).toBe(3);

    // Novo lançamento no ledger — um contador paralelo não saberia disto.
    await admin.asPlatformAdmin((tx) =>
      tx.creditLedger.create({
        data: {
          tenantId: tenant.tenantId,
          membershipId: seeded.membershipId,
          serviceId: tenant.serviceId,
          delta: 3,
          reason: CREDIT_REASON.cycleGrant,
        },
      }),
    );

    const after = await loadCustomerClub(clubContext(tenant.tenantId), tenant.customerMemberId);
    const afterBalance = after.memberships[0]?.benefits.find(
      (benefit) => benefit.serviceId === tenant.serviceId,
    );
    expect(afterBalance?.balance).toBe(4);
  });

  it('um cliente não cancela a assinatura de outro cliente do mesmo salão', async () => {
    const tenant = await freshTenant('views-cancel');
    const secondCustomer = await createCustomerMember(tenant.tenantId, 'Cliente dois');
    const seededA2 = await seedMembership(tenant.tenantId, {
      customerMemberId: secondCustomer,
      planName: 'Clube do segundo',
      planPriceCents: 9900,
      contractedPriceCents: 9900,
    });

    const result = await cancelMembership({
      tenantId: tenant.tenantId,
      membershipId: seededA2.membershipId,
      actor: { kind: 'CUSTOMER', memberId: tenant.customerMemberId },
    });

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    // A assinatura do segundo cliente segue intacta.
    const persisted = await scoped.forTenant(tenant.tenantId, (tx) =>
      tx.membership.findFirst({
        where: { id: seededA2.membershipId },
        select: { status: true },
      }),
    );
    expect(persisted?.status).toBe('ACTIVE');
  });

  it('assinante de outro tenant é invisível e não pode ser cancelado', async () => {
    const tenantA = await freshTenant('views-cross-a');
    const tenantB = await freshTenant('views-cross-b');

    const seededA = await seedMembership(tenantA.tenantId, {
      customerMemberId: tenantA.customerMemberId,
      planName: 'Clube A',
      planPriceCents: 6900,
      contractedPriceCents: 6900,
    });

    // O cliente do B não enxerga o clube do A.
    const forB = await loadCustomerClub(clubContext(tenantB.tenantId), tenantB.customerMemberId);
    expect(forB.memberships).toEqual([]);

    // E não consegue cancelar a assinatura do A nem sabendo o id.
    const result = await cancelMembership({
      tenantId: tenantB.tenantId,
      membershipId: seededA.membershipId,
      actor: { kind: 'CUSTOMER', memberId: tenantB.customerMemberId },
    });
    expect(result).toMatchObject({ ok: false, code: 'MEMBERSHIP_NOT_FOUND' });
  });
});
