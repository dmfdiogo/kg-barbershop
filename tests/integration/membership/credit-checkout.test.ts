// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHold } from '@/lib/booking/hold';
import { CREDIT_REASON } from '@/lib/membership/credits';
import {
  CheckoutError,
  confirmWithCredit,
  loadCheckoutQuote,
  startCheckout,
} from '@/lib/payments/charge';
import { resolveTenantById, toTenantContext, type TenantContext } from '@/lib/tenant/context';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * A COSTURA entre o clube (F5.2) e o checkout (F4.2).
 *
 * O módulo de crédito e o de cobrança nasceram em tarefas separadas e corretas
 * cada um por si; o defeito mora entre os dois. Sem esta ligação, o assinante
 * era mandado ao checkout, PAGAVA, e o crédito continuava intacto — porque
 * quem debita é participante da confirmação, e o caminho pago confirma por
 * webhook. Estes testes existem para que essa combinação não volte.
 */

const SLOT_BASE = Date.UTC(2027, 2, 1, 9, 0, 0);
let slot = 0;

describe('checkout coberto pelo clube', () => {
  let admin: TenantDb;
  const created: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
  });

  afterAll(async () => {
    for (const tenantId of created) await deleteTenant(admin, tenantId);
    await admin.disconnect();
  });

  async function freshTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    created.push(fixture.tenantId);
    return fixture;
  }

  async function contextFor(tenantId: string): Promise<TenantContext> {
    const lookup = await resolveTenantById(tenantId);
    if (!lookup.ok) throw new Error('tenant de teste não resolvido');
    return toTenantContext(lookup);
  }

  /**
   * Serviço pré-pago com conta aprovada: sem isto o checkout degrada para
   * ON_SITE e o teste não exercitaria o caminho de cobrança.
   */
  async function makePrepaid(fixture: TenantFixture): Promise<void> {
    await admin.asPlatformAdmin(async (tx) => {
      await tx.service.update({
        where: { id: fixture.serviceId },
        data: { paymentMode: 'FULL_PREPAID' },
      });
      await tx.asaasAccount.create({
        data: {
          tenantId: fixture.tenantId,
          asaasAccountId: `acc_${fixture.tenantId.slice(-8)}`,
          walletId: `wal_${fixture.tenantId.slice(-8)}`,
          apiKeyEnc: 'enc',
          kycStatus: 'APPROVED',
          pixKey: 'pix@teste.com',
        },
      });
    });
  }

  async function seedClub(
    fixture: TenantFixture,
    options: { balance: number; requiresDeposit?: boolean },
  ): Promise<void> {
    await admin.asPlatformAdmin(async (tx) => {
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
          contractedPriceCents: 6900,
        },
      });
      if (options.balance > 0) {
        await tx.creditLedger.create({
          data: {
            tenantId: fixture.tenantId,
            membershipId: membership.id,
            serviceId: fixture.serviceId,
            delta: options.balance,
            reason: CREDIT_REASON.cycleGrant,
          },
        });
      }
      if (options.requiresDeposit) {
        await tx.tenant.update({
          where: { id: fixture.tenantId },
          data: { membershipRequiresDeposit: true },
        });
      }
    });
  }

  async function newHold(fixture: TenantFixture, label: string): Promise<string> {
    slot += 1;
    const hold = await createHold({
      tenantId: fixture.tenantId,
      customerId: fixture.customerMemberId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      startsAt: new Date(SLOT_BASE + slot * 24 * 3_600_000),
      holdSessionId: `sess-${label}-${slot}`,
    });
    return hold.id;
  }

  it('a cotação avisa que o clube cobre, e o checkout recusa cobrar', async () => {
    const fixture = await freshTenant('credit-quote');
    await makePrepaid(fixture);
    await seedClub(fixture, { balance: 2 });
    const ctx = await contextFor(fixture.tenantId);
    const holdId = await newHold(fixture, 'quote');

    const quote = await loadCheckoutQuote({
      ctx,
      holdId,
      memberId: fixture.customerMemberId,
      holdSessionId: `sess-quote-${slot}`,
    });
    expect(quote.credit).toEqual({ covered: true, balance: 2, requiresDeposit: false });

    // Última barreira: mesmo que a tela esteja velha e mande cobrar, o
    // assinante não paga por algo que o clube dele cobre.
    await expect(
      startCheckout({
        ctx,
        holdId,
        memberId: fixture.customerMemberId,
        holdSessionId: `sess-quote-${slot}`,
        method: 'PIX',
      }),
    ).rejects.toBeInstanceOf(CheckoutError);
  });

  it('confirmar com crédito debita e não cria cobrança', async () => {
    const fixture = await freshTenant('credit-confirm');
    await makePrepaid(fixture);
    await seedClub(fixture, { balance: 1 });
    const ctx = await contextFor(fixture.tenantId);
    const holdId = await newHold(fixture, 'confirm');

    const result = await confirmWithCredit({
      ctx,
      holdId,
      memberId: fixture.customerMemberId,
      holdSessionId: `sess-confirm-${slot}`,
    });

    expect(result.kind).toBe('credit');
    expect(result.balanceAfter).toBe(0);

    const state = await forTenant(fixture.tenantId, async (tx) => ({
      booking: await tx.booking.findFirstOrThrow({
        where: { id: holdId },
        select: { status: true },
      }),
      payments: await tx.payment.count({ where: { bookingId: holdId } }),
      // Saldo pela SOMA do ledger, que é a definição — não há contador.
      balance:
        (
          await tx.creditLedger.aggregate({
            where: { tenantId: fixture.tenantId, serviceId: fixture.serviceId },
            _sum: { delta: true },
          })
        )._sum.delta ?? 0,
    }));

    expect(state.booking.status).toBe('CONFIRMED');
    expect(state.payments).toBe(0);
    expect(state.balance).toBe(0);
  });

  it('sem saldo, confirmar com crédito é recusado e o horário segue reservado', async () => {
    const fixture = await freshTenant('credit-empty');
    await makePrepaid(fixture);
    await seedClub(fixture, { balance: 0 });
    const ctx = await contextFor(fixture.tenantId);
    const holdId = await newHold(fixture, 'empty');

    await expect(
      confirmWithCredit({
        ctx,
        holdId,
        memberId: fixture.customerMemberId,
        holdSessionId: `sess-empty-${slot}`,
      }),
    ).rejects.toBeInstanceOf(CheckoutError);

    const booking = await forTenant(fixture.tenantId, (tx) =>
      tx.booking.findFirstOrThrow({ where: { id: holdId }, select: { status: true } }),
    );
    expect(booking.status).toBe('HOLD');
  });

  it('com a flag de sinal ligada, o assinante volta para o caminho pago', async () => {
    const fixture = await freshTenant('credit-deposit');
    await makePrepaid(fixture);
    await seedClub(fixture, { balance: 2, requiresDeposit: true });
    const ctx = await contextFor(fixture.tenantId);
    const holdId = await newHold(fixture, 'deposit');

    const quote = await loadCheckoutQuote({
      ctx,
      holdId,
      memberId: fixture.customerMemberId,
      holdSessionId: `sess-deposit-${slot}`,
    });
    expect(quote.credit).toEqual({ covered: true, balance: 2, requiresDeposit: true });

    await expect(
      confirmWithCredit({
        ctx,
        holdId,
        memberId: fixture.customerMemberId,
        holdSessionId: `sess-deposit-${slot}`,
      }),
    ).rejects.toBeInstanceOf(CheckoutError);
  });
});
