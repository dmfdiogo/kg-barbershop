// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/payments/route';
import { CREDIT_REASON } from '@/lib/membership/credits';
import type { MembershipWebhookEvent } from '@/lib/membership/subscription';
import { PAYMENTS_WEBHOOK_TOKEN_HEADER } from '@/lib/payments/webhook';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * A COSTURA entre o ciclo de vida da assinatura (F5.1) e o ledger (F5.2), pela
 * rota de verdade.
 *
 * Duas coisas que nenhuma das duas tarefas podia provar sozinha:
 *
 *  1. o mesmo endpoint de webhook atende cobrança E assinatura — o provedor tem
 *     uma URL por subconta, não uma por assunto. Sem o despacho, renovação
 *     chegava e era respondida com 400;
 *  2. renovar o ciclo CREDITA. A F5.1 transicionava o status e a F5.2 tinha o
 *     ledger; ninguém ligava os dois, então o assinante pagava o mês e não
 *     recebia crédito nenhum.
 */

const SECRET = 'renewal-secret';
const runId = randomUUID().slice(0, 8);
let seq = 0;

describe('renovação do clube pelo webhook', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let membershipId: string;
  let planId: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'renew-wh');

    const seeded = await admin.asPlatformAdmin(async (tx) => {
      const plan = await tx.membershipPlan.create({
        data: {
          tenantId: fixture.tenantId,
          name: 'Clube',
          priceCents: 7900,
          cycle: 'MONTHLY',
        },
      });
      await tx.membershipBenefit.create({
        data: {
          tenantId: fixture.tenantId,
          planId: plan.id,
          serviceId: fixture.serviceId,
          quantityPerCycle: 2,
        },
      });
      const membership = await tx.membership.create({
        data: {
          tenantId: fixture.tenantId,
          customerId: fixture.customerMemberId,
          planId: plan.id,
          status: 'ACTIVE',
          // Preço CONTRATADO abaixo do preço corrente do plano, de propósito:
          // o payload da renovação traz este valor, e validar contra o preço do
          // plano recusaria uma renovação legítima.
          contractedPriceCents: 6900,
          asaasSubscriptionId: `sub_${runId}`,
          currentPeriodEnd: new Date(Date.UTC(2027, 0, 1)),
        },
      });
      return { membershipId: membership.id, planId: plan.id };
    });
    membershipId = seeded.membershipId;
    planId = seeded.planId;
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_${runId}` } } }),
      );
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renewalEvent(periodEnd: string): MembershipWebhookEvent {
    seq += 1;
    return {
      provider: 'mock',
      eventId: `evt_${runId}_${seq}`,
      type: 'SUBSCRIPTION_CYCLE_RENEWED',
      occurredAt: new Date().toISOString(),
      data: {
        subscription: {
          id: `sub_${runId}`,
          accountId: 'acc_mock',
          customerId: fixture.customerMemberId,
          planId,
          membershipId,
          status: 'ACTIVE',
          amountCents: 6900,
          currentPeriodEnd: periodEnd,
        },
      },
    };
  }

  function post(event: MembershipWebhookEvent): Promise<Response> {
    const rawBody = JSON.stringify(event);
    return POST(
      new Request('http://localhost/api/webhooks/payments', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [PAYMENTS_WEBHOOK_TOKEN_HEADER]: SECRET,
        },
        body: rawBody,
      }),
    );
  }

  function ledger() {
    return forTenant(fixture.tenantId, (tx) =>
      tx.creditLedger.findMany({
        where: { tenantId: fixture.tenantId, membershipId },
        select: { delta: true, reason: true },
      }),
    );
  }

  it('a rota aceita evento de assinatura e a renovação credita o ciclo', async () => {
    const response = await post(renewalEvent('2027-02-01T00:00:00.000Z'));
    expect(response.status).toBe(200);

    const rows = await ledger();
    const granted = rows.filter((row) => row.reason === CREDIT_REASON.cycleGrant);
    expect(granted).toHaveLength(1);
    expect(granted[0]!.delta).toBe(2);

    const membership = await forTenant(fixture.tenantId, (tx) =>
      tx.membership.findFirstOrThrow({
        where: { id: membershipId },
        select: { status: true, currentPeriodEnd: true },
      }),
    );
    expect(membership.status).toBe('ACTIVE');
    expect(membership.currentPeriodEnd?.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('reentrega do mesmo evento não credita de novo', async () => {
    const event = renewalEvent('2027-03-01T00:00:00.000Z');
    await post(event);
    const afterFirst = (await ledger()).length;

    const repeat = await post(event);
    expect(repeat.status).toBe(200);
    expect((await ledger()).length).toBe(afterFirst);
  });

  it('ciclo seguinte expira o saldo não usado antes de conceder o novo', async () => {
    // A política documentada em `credits.ts`: crédito não usado NÃO acumula.
    const before = await ledger();
    const saldoAntes = before.reduce((total, row) => total + row.delta, 0);
    expect(saldoAntes).toBeGreaterThan(0);

    await post(renewalEvent('2027-04-01T00:00:00.000Z'));

    const rows = await ledger();
    expect(rows.some((row) => row.reason === CREDIT_REASON.cycleExpired)).toBe(true);
    expect(rows.reduce((total, row) => total + row.delta, 0)).toBe(2);
  });
});
