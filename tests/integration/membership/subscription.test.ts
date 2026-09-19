// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore, type MockPaymentStore } from '@/lib/payments/mock-store';
import { PaymentProviderError } from '@/lib/payments/types';
import {
  cancelMembership,
  extractPayerIpFromHeaders,
  parseMembershipWebhookEvent,
  processMembershipWebhook,
  subscribeMembership,
  type MembershipWebhookEvent,
  type MembershipWebhookEventType,
  type MembershipStatus,
} from '@/lib/membership/subscription';
import { createPlan } from '@/lib/membership/plans';
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
 * Ciclo de vida da assinatura do clube (tarefa F5.1), contra Postgres real e o
 * `MockPaymentProvider`. O que se prova:
 *
 *   - assinar → renovar → falhar → suspender → renovar → cancelar;
 *   - a cobrança NASCE NA SUBCONTA do salão, com split para a plataforma, e o
 *     teste falha se a direção inverter;
 *   - `remoteIp` do servidor é recusado ANTES de criar qualquer efeito;
 *   - duplo clique / webhook reentregue não cria duas cobranças recorrentes;
 *   - preço contratado congela (reajustar o plano não reajusta o assinante);
 *   - webhook é idempotente e não ressuscita assinatura encerrada;
 *   - assinatura de um tenant é invisível no outro.
 */

const CARD = {
  number: '4111111111111111',
  holderName: 'Assinante Teste',
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
};

const STATUS_BY_TYPE: Record<MembershipWebhookEventType, MembershipStatus> = {
  SUBSCRIPTION_CYCLE_RENEWED: 'ACTIVE',
  SUBSCRIPTION_PAYMENT_FAILED: 'PAST_DUE',
  SUBSCRIPTION_CANCELED: 'CANCELED',
  SUBSCRIPTION_EXPIRED: 'EXPIRED',
};

interface Provisioned {
  tenant: TenantFixture;
  planId: string;
  accountId: string;
  walletId: string;
}

interface MembershipRow {
  id: string;
  planId: string;
  customerId: string;
  status: MembershipStatus;
  contractedPriceCents: number;
  asaasSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
}

describe('membership: ciclo de assinatura do clube', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let store: MockPaymentStore;
  let provider: MockPaymentProvider;
  const tenants: string[] = [];
  const eventIds: string[] = [];
  let originalPlatformWallet: string | undefined;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
    store = createMockPaymentStore();
    provider = new MockPaymentProvider({
      store,
      transport: {
        async deliver() {
          return { ok: true, status: 200 };
        },
      },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: 'integration-membership-secret',
    });

    // A taxa e a carteira da plataforma são configuração; o `.env` já as traz,
    // mas o teste não deve depender do arquivo de desenvolvimento.
    originalPlatformWallet = process.env.PLATFORM_WALLET_ID;
    process.env.PLATFORM_WALLET_ID ||= 'mock-platform-wallet';
    process.env.PLATFORM_FEE_BASIS_POINTS ||= '1000';
  }, 180_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    if (eventIds.length > 0) {
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }),
      );
    }
    for (const tenantId of tenants) {
      await deleteTenant(admin, tenantId);
    }
    if (originalPlatformWallet === undefined) {
      delete process.env.PLATFORM_WALLET_ID;
    } else {
      process.env.PLATFORM_WALLET_ID = originalPlatformWallet;
    }
    await scoped?.disconnect();
    await admin?.disconnect();
  });

  /**
   * Cria tenant, subconta Asaas APROVADA no provedor (e em `AsaasAccount`) e um
   * plano mensal. A subconta é criada pelo mock e aprovada por `simulateKycDecision`,
   * exatamente o caminho da F4.1.
   */
  async function provision(prefix: string, priceCents = 6900): Promise<Provisioned> {
    const tenant = await createTenantFixture(admin, prefix);
    tenants.push(tenant.tenantId);

    const merchant = await provider.createMerchantAccount({
      name: `Salão ${prefix}`,
      document: '12345678909',
    });
    await provider.simulateKycDecision(merchant.accountId, 'APPROVED');

    await admin.asPlatformAdmin((tx) =>
      tx.asaasAccount.create({
        data: {
          tenantId: tenant.tenantId,
          asaasAccountId: merchant.accountId,
          walletId: merchant.walletId,
          apiKeyEnc: 'seed-encrypted-placeholder',
          pixKey: `${prefix}@exemplo.com.br`,
          kycStatus: 'APPROVED',
        },
      }),
    );

    const plan = await scoped.forTenant(tenant.tenantId, (tx) =>
      createPlan(tx, tenant.tenantId, {
        name: 'Clube mensal',
        priceCents,
        cycle: 'MONTHLY',
        active: true,
        benefits: [],
      }),
    );

    return {
      tenant,
      planId: plan.id,
      accountId: merchant.accountId,
      walletId: merchant.walletId,
    };
  }

  async function subscribe(
    p: Provisioned,
    remoteIp: string | null | undefined = '8.8.8.8',
  ) {
    return subscribeMembership({
      tenantId: p.tenant.tenantId,
      customerId: p.tenant.customerMemberId,
      planId: p.planId,
      card: CARD,
      remoteIp,
      provider,
    });
  }

  async function membershipRow(tenantId: string, membershipId: string): Promise<MembershipRow | null> {
    return scoped.forTenant(tenantId, (tx) =>
      tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        select: {
          id: true,
          planId: true,
          customerId: true,
          status: true,
          contractedPriceCents: true,
          asaasSubscriptionId: true,
          currentPeriodEnd: true,
        },
      }),
    ) as Promise<MembershipRow | null>;
  }

  function eventFor(
    type: MembershipWebhookEventType,
    row: MembershipRow,
    accountId: string,
    currentPeriodEnd: Date,
  ): MembershipWebhookEvent {
    return {
      provider: 'mock',
      eventId: `evt_membership_${randomUUID()}`,
      type,
      occurredAt: new Date().toISOString(),
      data: {
        subscription: {
          id: row.asaasSubscriptionId ?? 'sub_missing',
          accountId,
          customerId: row.customerId,
          planId: row.planId,
          membershipId: row.id,
          status: STATUS_BY_TYPE[type],
          amountCents: row.contractedPriceCents,
          currentPeriodEnd: currentPeriodEnd.toISOString(),
        },
      },
    };
  }

  async function deliver(event: MembershipWebhookEvent) {
    eventIds.push(event.eventId);
    expect(parseMembershipWebhookEvent(JSON.stringify(event))).not.toBeNull();
    return processMembershipWebhook(event, JSON.stringify(event));
  }

  function subscriptionsFor(customerId: string) {
    return [...store.subscriptions.values()].filter((sub) => sub.customerId === customerId);
  }

  it('assinar → renovar → falhar → suspender → renovar → cancelar', async () => {
    const p = await provision('mem-cycle');
    const subscribed = await subscribe(p);
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const row = await membershipRow(p.tenant.tenantId, subscribed.membership.id);
    expect(row).toMatchObject({ status: 'ACTIVE', contractedPriceCents: 6900 });
    expect(row?.asaasSubscriptionId).toBeTruthy();

    const firstPeriodEnd = row?.currentPeriodEnd as Date;
    const renewed = await deliver(
      eventFor(
        'SUBSCRIPTION_CYCLE_RENEWED',
        row as MembershipRow,
        p.accountId,
        new Date(firstPeriodEnd.getTime() + 30 * 24 * 60 * 60_000),
      ),
    );
    expect(renewed.status).toBe(200);

    const afterRenew = await membershipRow(p.tenant.tenantId, row!.id);
    expect(afterRenew?.status).toBe('ACTIVE');
    expect(afterRenew?.currentPeriodEnd!.getTime()).toBeGreaterThan(firstPeriodEnd.getTime());

    const failed = await deliver(
      eventFor('SUBSCRIPTION_PAYMENT_FAILED', afterRenew as MembershipRow, p.accountId, afterRenew!.currentPeriodEnd as Date),
    );
    expect(failed.status).toBe(200);
    expect((await membershipRow(p.tenant.tenantId, row!.id))?.status).toBe('PAST_DUE');

    const recovered = await deliver(
      eventFor(
        'SUBSCRIPTION_CYCLE_RENEWED',
        (await membershipRow(p.tenant.tenantId, row!.id)) as MembershipRow,
        p.accountId,
        new Date(afterRenew!.currentPeriodEnd!.getTime() + 30 * 24 * 60 * 60_000),
      ),
    );
    expect(recovered.status).toBe(200);
    expect((await membershipRow(p.tenant.tenantId, row!.id))?.status).toBe('ACTIVE');

    const canceled = await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId: row!.id,
      actor: { kind: 'CUSTOMER', memberId: p.tenant.customerMemberId },
      provider,
    });
    expect(canceled.ok).toBe(true);
    if (canceled.ok) {
      expect(canceled.membership.status).toBe('CANCELED');
      expect(canceled.policy.creditDisposition).toBe('USE_UNTIL_PERIOD_END_THEN_EXPIRE');
    }
    expect((await membershipRow(p.tenant.tenantId, row!.id))?.status).toBe('CANCELED');
  });

  it('a cobrança nasce na subconta do salão, com split para a plataforma', async () => {
    const p = await provision('mem-subaccount');
    const subscribed = await subscribe(p);
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const subscription = [...store.subscriptions.values()].find(
      (sub) => sub.id === subscribed.membership.asaasSubscriptionId,
    );
    expect(subscription?.accountId).toBe(p.accountId);
    expect(subscription?.accountId).not.toBe('acc_platform');
    expect(subscription?.split[0]?.walletId).toBe(process.env.PLATFORM_WALLET_ID);
    expect(subscription?.split[0]?.walletId).not.toBe(p.walletId);
    expect(subscription?.amountCents).toBe(6900);
  });

  it('FALHA se a cobrança sair da conta da plataforma em vez da subconta', async () => {
    // A plataforma também é uma conta no provedor; o erro perigoso é criar a
    // assinatura NELA e tentar dividir para a própria carteira. O mock recusa
    // (SPLIT_TO_SELF) e o serviço nunca faz isso — cobra na subconta.
    const platform = await provider.createMerchantAccount({
      name: 'Plataforma',
      document: '19131243000197',
    });
    await provider.simulateKycDecision(platform.accountId, 'APPROVED');

    process.env.PLATFORM_WALLET_ID = platform.walletId;
    try {
      const { token } = await provider.tokenizeCard({
        accountId: platform.accountId,
        customerId: 'platform-customer',
        ...CARD,
        remoteIp: '8.8.8.8',
      });

      await expect(
        provider.createSubscription({
          accountId: platform.accountId,
          customerId: 'platform-customer',
          planId: 'plan_platform',
          amountCents: 6900,
          cycle: 'MONTHLY',
          nextDueDate: '2030-01-15',
          cardToken: token,
          remoteIp: '8.8.8.8',
          split: [{ walletId: platform.walletId, fixedValueCents: 690 }],
        }),
      ).rejects.toMatchObject({ code: 'SPLIT_TO_SELF' });

      // Com o split apontando para a plataforma, o serviço cobra na SUBCONTA do
      // salão e passa: se ele usasse a conta da plataforma, o próprio mock
      // recusaria acima.
      const p = await provision('mem-direction');
      const subscribed = await subscribe(p);
      expect(subscribed.ok).toBe(true);
      if (subscribed.ok) {
        const subscription = [...store.subscriptions.values()].find(
          (sub) => sub.id === subscribed.membership.asaasSubscriptionId,
        );
        expect(subscription?.accountId).toBe(p.accountId);
        expect(subscription?.split[0]?.walletId).toBe(platform.walletId);
      }
    } finally {
      process.env.PLATFORM_WALLET_ID = originalPlatformWallet ?? 'mock-platform-wallet';
    }
  });

  it('FALHA se remoteIp for do servidor — antes de criar qualquer efeito', async () => {
    // Fixa a regra de produção: em desenvolvimento `DEV_PAYER_IP` é aceito como
    // origem do loopback. Aqui o guard tem de ser o de produção, sem exceção.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DEV_PAYER_IP', undefined);

    const p = await provision('mem-remote-ip');

    for (const remoteIp of ['10.0.0.5', '127.0.0.1'] as const) {
      const result = await subscribe(p, remoteIp);
      expect(result).toMatchObject({ ok: false, code: 'INVALID_REMOTE_IP' });
    }

    // Ausência do header: erro explícito, nunca o IP do servidor como fallback.
    const missing = await subscribeMembership({
      tenantId: p.tenant.tenantId,
      customerId: p.tenant.customerMemberId,
      planId: p.planId,
      card: CARD,
      remoteIp: undefined,
      provider,
    });
    expect(missing).toMatchObject({ ok: false, code: 'INVALID_REMOTE_IP' });

    expect(
      await scoped.forTenant(p.tenant.tenantId, (tx) =>
        tx.membership.count({ where: { tenantId: p.tenant.tenantId } }),
      ),
    ).toBe(0);
    expect(subscriptionsFor(p.tenant.customerMemberId)).toHaveLength(0);

    // O mock também recusa o IP do servidor, na tokenização e na assinatura.
    await expect(
      provider.tokenizeCard({
        accountId: p.accountId,
        customerId: p.tenant.customerMemberId,
        ...CARD,
        remoteIp: '10.0.0.5',
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);

    // A extração do header é a do checkout (F4.2): primeiro IP do XFF.
    const headers = new Headers({
      'x-forwarded-for': '8.8.8.8, 10.0.0.5',
      'x-real-ip': '10.0.0.5',
    });
    expect(extractPayerIpFromHeaders(headers)).toBe('8.8.8.8');
  });

  it('duplo clique não cria segunda cobrança; concorrência também não', async () => {
    const p = await provision('mem-double');
    const first = await subscribe(p);
    expect(first.ok).toBe(true);

    const second = await subscribe(p);
    expect(second).toMatchObject({ ok: false, code: 'ALREADY_SUBSCRIBED' });
    expect(subscriptionsFor(p.tenant.customerMemberId)).toHaveLength(1);

    const concurrent = await provision('mem-race');
    const [a, b] = await Promise.all([subscribe(concurrent), subscribe(concurrent)]);
    const oks = [a, b].filter((result) => result.ok);
    expect(oks).toHaveLength(1);
    expect(subscriptionsFor(concurrent.tenant.customerMemberId)).toHaveLength(1);
  });

  it('reajustar o plano não altera o assinante nem aceita cobrança com o preço novo', async () => {
    const p = await provision('mem-frozen', 7900);
    const subscribed = await subscribe(p);
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const plan = await scoped.forTenant(p.tenant.tenantId, (tx) =>
      tx.membershipPlan.update({
        where: { id: p.planId },
        data: { priceCents: 8900 },
        select: { priceCents: true },
      }),
    );
    expect(plan.priceCents).toBe(8900);

    const row = (await membershipRow(p.tenant.tenantId, subscribed.membership.id)) as MembershipRow;
    expect(row.contractedPriceCents).toBe(7900);

    // Evento de renovação cobrando o preço NOVO é recusado (400): preço do
    // payload é entrada não confiável e divergir do contratado invalida.
    const wrong = eventFor('SUBSCRIPTION_CYCLE_RENEWED', row, p.accountId, new Date(Date.now() + 86_400_000));
    wrong.data.subscription!.amountCents = 8900;
    eventIds.push(wrong.eventId);
    await expect(processMembershipWebhook(wrong, JSON.stringify(wrong))).rejects.toMatchObject({
      status: 400,
    });

    const correct = eventFor('SUBSCRIPTION_CYCLE_RENEWED', row, p.accountId, new Date(Date.now() + 86_400_000));
    const applied = await deliver(correct);
    expect(applied.status).toBe(200);
  });

  it('webhook reentregue não renova duas vezes e não ressuscita assinatura encerrada', async () => {
    const p = await provision('mem-idem');
    const subscribed = await subscribe(p);
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    const row = (await membershipRow(p.tenant.tenantId, subscribed.membership.id)) as MembershipRow;
    const renewal = eventFor(
      'SUBSCRIPTION_CYCLE_RENEWED',
      row,
      p.accountId,
      new Date((row.currentPeriodEnd as Date).getTime() + 30 * 24 * 60 * 60_000),
    );
    eventIds.push(renewal.eventId);

    const applied = await processMembershipWebhook(renewal, JSON.stringify(renewal));
    expect(applied.status).toBe(200);
    const afterFirst = await membershipRow(p.tenant.tenantId, row.id);

    const repeated = await processMembershipWebhook(renewal, JSON.stringify(renewal));
    expect(repeated.body.duplicate).toBe(true);

    const afterRepeat = await membershipRow(p.tenant.tenantId, row.id);
    expect(afterRepeat?.currentPeriodEnd?.getTime()).toBe(afterFirst?.currentPeriodEnd?.getTime());

    const count = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId: renewal.eventId } }),
    );
    expect(count).toBe(1);

    // Outro evento, mesmo alvo já aplicado: already-applied, sem novo efeito.
    const stale = eventFor('SUBSCRIPTION_CYCLE_RENEWED', afterFirst as MembershipRow, p.accountId, new Date(Date.now() + 86_400_000));
    const staleResult = await deliver(stale);
    expect(staleResult.body.applied).toContain('already');

    // Cancelada é terminal: renovação atrasada é ignorada e não reabre.
    await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId: row.id,
      actor: { kind: 'CUSTOMER', memberId: p.tenant.customerMemberId },
      provider,
    });
    const canceledRow = (await membershipRow(p.tenant.tenantId, row.id)) as MembershipRow;
    const lateRenewal = eventFor(
      'SUBSCRIPTION_CYCLE_RENEWED',
      canceledRow,
      p.accountId,
      new Date(Date.now() + 200 * 24 * 60 * 60_000),
    );
    const ignored = await deliver(lateRenewal);
    expect(ignored.body.applied).toContain('ignored');
    expect((await membershipRow(p.tenant.tenantId, row.id))?.status).toBe('CANCELED');
  });

  it('cancelar pelo dono exige papel OWNER; pelo cliente, só a própria assinatura', async () => {
    const p = await provision('mem-cancel-auth');
    const subscribed = await subscribe(p);
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;
    const membershipId = subscribed.membership.id;

    const staffUserId = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember
        .findUnique({ where: { id: p.tenant.staffMemberId }, select: { userId: true } })
        .then((row) => row?.userId ?? ''),
    );
    const ownerUserId = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember
        .findUnique({ where: { id: p.tenant.ownerMemberId }, select: { userId: true } })
        .then((row) => row?.userId ?? ''),
    );

    const forbiddenOwner = await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId,
      actor: { kind: 'OWNER', userId: staffUserId },
      provider,
    });
    expect(forbiddenOwner).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const forbiddenCustomer = await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId,
      actor: { kind: 'CUSTOMER', memberId: p.tenant.ownerMemberId },
      provider,
    });
    expect(forbiddenCustomer).toMatchObject({ ok: false, code: 'FORBIDDEN' });

    const byOwner = await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId,
      actor: { kind: 'OWNER', userId: ownerUserId },
      provider,
    });
    expect(byOwner.ok).toBe(true);

    // Cancelar de novo é idempotente.
    const again = await cancelMembership({
      tenantId: p.tenant.tenantId,
      membershipId,
      actor: { kind: 'OWNER', userId: ownerUserId },
      provider,
    });
    expect(again.ok).toBe(true);
  });

  it('A não lê a assinatura de B (isolamento + RLS)', async () => {
    const a = await provision('mem-iso-a');
    const b = await provision('mem-iso-b');
    const subA = await subscribe(a);
    const subB = await subscribe(b);
    expect(subA.ok && subB.ok).toBe(true);
    if (!subA.ok || !subB.ok) return;

    const listA = await scoped.forTenant(a.tenant.tenantId, (tx) =>
      tx.membership.findMany({ select: { id: true } }),
    );
    expect(listA.some((row) => row.id === subA.membership.id)).toBe(true);
    expect(listA.some((row) => row.id === subB.membership.id)).toBe(false);

    // Sem `tenantId` explícito, a RLS sozinha já filtra o outro tenant.
    const rlsOnly = await scoped.forTenant(a.tenant.tenantId, (tx) =>
      tx.membership.count(),
    );
    expect(rlsOnly).toBe(1);

    // Webhook de B resolve B e não mexe em A.
    const rowB = (await membershipRow(b.tenant.tenantId, subB.membership.id)) as MembershipRow;
    await deliver(
      eventFor('SUBSCRIPTION_PAYMENT_FAILED', rowB, b.accountId, rowB.currentPeriodEnd as Date),
    );
    expect((await membershipRow(b.tenant.tenantId, subB.membership.id))?.status).toBe('PAST_DUE');
    expect((await membershipRow(a.tenant.tenantId, subA.membership.id))?.status).toBe('ACTIVE');
  });

  it('recusa plano inativo, ciclo não suportado e ausência de subconta', async () => {
    const p = await provision('mem-guards');

    const inactive = await scoped.forTenant(p.tenant.tenantId, (tx) =>
      createPlan(tx, p.tenant.tenantId, {
        name: 'Plano inativo',
        priceCents: 5000,
        cycle: 'MONTHLY',
        active: false,
        benefits: [],
      }),
    );
    const inactiveResult = await subscribeMembership({
      tenantId: p.tenant.tenantId,
      customerId: p.tenant.customerMemberId,
      planId: inactive.id,
      card: CARD,
      remoteIp: '8.8.8.8',
      provider,
    });
    expect(inactiveResult).toMatchObject({ ok: false, code: 'PLAN_INACTIVE' });

    const weekly = await scoped.forTenant(p.tenant.tenantId, (tx) =>
      createPlan(tx, p.tenant.tenantId, {
        name: 'Plano semanal',
        priceCents: 2500,
        cycle: 'WEEKLY',
        active: true,
        benefits: [],
      }),
    );
    const weeklyResult = await subscribeMembership({
      tenantId: p.tenant.tenantId,
      customerId: p.tenant.customerMemberId,
      planId: weekly.id,
      card: CARD,
      remoteIp: '8.8.8.8',
      provider,
    });
    expect(weeklyResult).toMatchObject({ ok: false, code: 'UNSUPPORTED_CYCLE' });

    const noAccount = await createTenantFixture(admin, 'mem-no-account');
    tenants.push(noAccount.tenantId);
    const plan = await scoped.forTenant(noAccount.tenantId, (tx) =>
      createPlan(tx, noAccount.tenantId, {
        name: 'Clube',
        priceCents: 6900,
        cycle: 'MONTHLY',
        active: true,
        benefits: [],
      }),
    );
    const noAccountResult = await subscribeMembership({
      tenantId: noAccount.tenantId,
      customerId: noAccount.customerMemberId,
      planId: plan.id,
      card: CARD,
      remoteIp: '8.8.8.8',
      provider,
    });
    expect(noAccountResult).toMatchObject({ ok: false, code: 'ACCOUNT_UNAVAILABLE' });
  });
});
