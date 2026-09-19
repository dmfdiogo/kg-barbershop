// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/webhooks/payments/route';
import {
  CheckoutError,
  computePlatformFeeCents,
  loadCheckoutQuote,
  resolveChargeAmountCents,
  startCheckout,
  type CardInput,
  type CheckoutResult,
} from '@/lib/payments/charge';
import {
  getMockPaymentProvider,
  getMockPaymentStore,
} from '@/lib/payments';
import type { PaymentWebhookEvent, PaymentWebhookEventType } from '@/lib/payments/webhook';
import { PAYMENTS_WEBHOOK_TOKEN_HEADER } from '@/lib/payments/webhook';
import type { PaymentMode } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';
import { resolveTenantById, toTenantContext } from '@/lib/tenant/context';
import { forTenant, getTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
} from '../helpers/test-database';

/**
 * Checkout B2C (F4.2) contra Postgres real + mock, cobrindo as três modalidades,
 * o split na subconta, o caminho degradado de KYC e a máquina de estados via
 * webhook (F4.0).
 *
 * O teste que sustenta o negócio: a cobrança TEM de nascer na subconta do
 * estabelecimento (`AsaasAccount.asaasAccountId`), com o split levando a taxa
 * para `PLATFORM_WALLET_ID`. Se algum dia a cobrança sair na conta principal, a
 * assertiva `charge.accountId === fixture.accountId` falha — é o guarda
 * automatizado da blindagem fiscal (plano §8.3).
 */

const SECRET = 'checkout-secret';
const PLATFORM_FEE_BASIS_POINTS = 1000;
const PLATFORM_WALLET_ID = 'mock-platform-wallet';
const PLATFORM_FEE_CENTS = 500;
const runId = randomUUID().slice(0, 8);

let seq = 0;

function randomPhone(): string {
  return `+5548${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0')}`;
}

interface CheckoutFixture {
  tenantId: string;
  slug: string;
  staffId: string;
  serviceId: string;
  customerMemberId: string;
  bookingId: string;
  accountId: string;
  walletId: string;
}

const createdFixtures: CheckoutFixture[] = [];

async function createFixture(
  admin: TenantDb,
  prefix: string,
  options: {
    paymentMode: PaymentMode;
    depositCents?: number;
    depositPercent?: number;
    kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    priceCents?: number;
  },
): Promise<CheckoutFixture> {
  seq += 1;
  const suffix = `${randomUUID().slice(0, 8)}-${seq}`;
  const slug = `${prefix}-${suffix}`;
  const provider = getMockPaymentProvider();
  const merchant = await provider.createMerchantAccount({
    name: `Salão ${suffix}`,
    document: '12345678901',
    pixKey: `${suffix}@exemplo.com.br`,
  });
  if (options.kycStatus === 'APPROVED') {
    await provider.simulateKycDecision(merchant.accountId, 'APPROVED');
  }

  return admin.asPlatformAdmin(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug,
        name: `Tenant ${suffix}`,
        document: '12345678901',
        timezone: 'America/Sao_Paulo',
        status: 'ACTIVE',
      },
    });
    const staffUser = await tx.user.create({
      data: { phone: randomPhone(), name: 'Profissional' },
    });
    const staffMember = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' },
    });
    const staff = await tx.staffProfile.create({
      data: { tenantId: tenant.id, tenantMemberId: staffMember.id },
    });

    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        name: 'Serviço de teste',
        durationMin: 30,
        bufferMin: 10,
        priceCents: options.priceCents ?? 5000,
        paymentMode: options.paymentMode,
        depositCents: options.depositCents ?? null,
        depositPercent: options.depositPercent ?? null,
      },
    });

    const customerUser = await tx.user.create({
      data: { phone: randomPhone(), name: 'Cliente' },
    });
    const customerMember = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: customerUser.id, role: 'CUSTOMER' },
    });

    // Hold anônimo, como nasce no fluxo da F3.3: o cliente é vinculado no
    // checkout. `startsAt` único por fixture para não colidir na constraint.
    const startsAt = new Date(Date.UTC(2030, 0, 1, 8, 0, 0) + seq * 3_600_000);
    const booking = await tx.booking.create({
      data: {
        tenantId: tenant.id,
        customerId: null,
        staffId: staff.id,
        serviceId: service.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 30 * 60_000),
        blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
        status: 'HOLD',
        holdExpiresAt: new Date(Date.now() + 10 * 60_000),
        holdSessionId: `device-${suffix}`,
        priceCents: service.priceCents,
        source: 'PORTAL',
      },
    });

    await tx.asaasAccount.create({
      data: {
        tenantId: tenant.id,
        asaasAccountId: merchant.accountId,
        walletId: merchant.walletId,
        apiKeyEnc: 'seed-encrypted-placeholder',
        pixKey: `${suffix}@exemplo.com.br`,
        kycStatus: options.kycStatus,
      },
    });

    const fixture: CheckoutFixture = {
      tenantId: tenant.id,
      slug,
      staffId: staff.id,
      serviceId: service.id,
      customerMemberId: customerMember.id,
      bookingId: booking.id,
      accountId: merchant.accountId,
      walletId: merchant.walletId,
    };
    createdFixtures.push(fixture);
    return fixture;
  });
}

async function contextFor(tenantId: string): Promise<TenantContext> {
  const lookup = await resolveTenantById(tenantId);
  if (!lookup.ok) throw new Error('Fixture tenant não resolveu.');
  return toTenantContext(lookup);
}

function buildEvent(
  type: PaymentWebhookEventType,
  chargeId: string,
  accountId: string,
  amountCents: number,
  eventId = `evt_checkout_${runId}_${randomUUID()}`,
): PaymentWebhookEvent {
  return {
    provider: 'mock',
    eventId,
    type,
    occurredAt: new Date().toISOString(),
    data: {
      charge: {
        id: chargeId,
        accountId,
        status: type === 'CHARGE_PAID' ? 'PAID' : type === 'CHARGE_REFUSED' ? 'REFUSED' : 'PENDING',
        amountCents,
        refundedCents: 0,
      },
    },
  };
}

function postWebhook(event: PaymentWebhookEvent): Promise<Response> {
  return POST(
    new Request('http://localhost/api/webhooks/payments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [PAYMENTS_WEBHOOK_TOKEN_HEADER]: SECRET,
      },
      body: JSON.stringify(event),
    }),
  );
}

function bookingState(tenantId: string, bookingId: string) {
  return forTenant(tenantId, (tx) =>
    tx.booking.findFirst({
      where: { id: bookingId },
      select: { status: true, customerId: true },
    }),
  );
}

function paymentFor(tenantId: string, bookingId: string) {
  return forTenant(tenantId, (tx) =>
    tx.payment.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    }),
  );
}

describe('checkout B2C', () => {
  let admin: TenantDb;
  let originalDatabaseUrl: string | undefined;
  let ctxCache: Map<string, TenantContext>;

  beforeAll(async () => {
    await ensureTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = rlsDatabaseUrl();
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');
    vi.stubEnv('PAYMENTS_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', String(PLATFORM_FEE_BASIS_POINTS));
    vi.stubEnv('PLATFORM_WALLET_ID', PLATFORM_WALLET_ID);
    // Sequência do mock por worker: sem isto, `chg_mock_1` de um worker colidiria
    // com o de outro (ou de uma execução anterior) e o webhook resolveria o
    // tenant errado pelo `asaasId`. Em produção o id é único no provedor.
    getMockPaymentStore().sequence = Math.floor(Math.random() * 1_000_000_000);
    admin = createAdminDb();
    ctxCache = new Map();
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      for (const fixture of createdFixtures) {
        await deleteTenant(admin, fixture.tenantId);
      }
      await admin.asPlatformAdmin((tx) =>
        tx.webhookEvent.deleteMany({ where: { eventId: { startsWith: `evt_checkout_${runId}` } } }),
      );
      await admin.disconnect();
    }
    getTenantDb().disconnect();
    vi.unstubAllEnvs();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  beforeEach(() => {
    vi.stubEnv('PAYMENT_PROVIDER', 'mock');
  });

  async function context(tenantId: string): Promise<TenantContext> {
    let ctx = ctxCache.get(tenantId);
    if (!ctx) {
      ctx = await contextFor(tenantId);
      ctxCache.set(tenantId, ctx);
    }
    return ctx;
  }

  async function start(
    fixture: CheckoutFixture,
    method: 'PIX' | 'CARD',
    extra: { card?: CardInput; remoteIp?: string } = {},
  ): Promise<CheckoutResult> {
    const ctx = await context(fixture.tenantId);
    return startCheckout({
      ctx,
      holdId: fixture.bookingId,
      memberId: fixture.customerMemberId,
      method,
      ...(extra.card ? { card: extra.card } : {}),
      ...(extra.remoteIp ? { remoteIp: extra.remoteIp } : {}),
    });
  }

  function storedCharge(chargeId: string) {
    const charge = getMockPaymentStore().charges.get(chargeId);
    if (!charge) throw new Error(`Cobrança ${chargeId} não existe no mock.`);
    return charge;
  }

  // -------------------------------------------------------------------------
  // 1. Integral antecipado
  // -------------------------------------------------------------------------

  it('integral antecipado: cria a cobrança na SUBCONTA com split para a plataforma', async () => {
    const fixture = await createFixture(admin, 'full', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });

    const result = await start(fixture, 'PIX');
    expect(result.kind).toBe('charge');
    if (result.kind !== 'charge') return;

    expect(result.amountCents).toBe(5000);
    expect(result.platformFeeCents).toBe(PLATFORM_FEE_CENTS);

    const payment = await paymentFor(fixture.tenantId, fixture.bookingId);
    expect(payment?.status).toBe('PENDING');
    expect(payment?.provider).toBe('mock');
    expect(payment?.platformFeeCents).toBe(PLATFORM_FEE_CENTS);
    expect(payment?.asaasId).toBeTruthy();

    // O TESTE QUE SUSTENTA O NEGÓCIO: a cobrança nasce na subconta do salão,
    // não na conta principal, e o split vai para a carteira da plataforma.
    const charge = storedCharge(payment!.asaasId!);
    expect(charge.accountId).toBe(fixture.accountId);
    expect(charge.accountId).not.toBe(PLATFORM_WALLET_ID);
    expect(charge.split).toEqual([
      { walletId: PLATFORM_WALLET_ID, fixedValueCents: PLATFORM_FEE_CENTS },
    ]);
  });

  it('cobrar fora da subconta (split para a própria carteira) é recusado pelo provedor', async () => {
    const fixture = await createFixture(admin, 'guard', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const provider = getMockPaymentProvider();

    // Controle negativo: documenta POR QUE a direção importa. A conta principal
    // não pode criar a cobrança e mandar a taxa para a própria carteira — o
    // Asaas (e o mock) recusam.
    await expect(
      provider.createCharge({
        accountId: fixture.accountId,
        customerId: fixture.customerMemberId,
        method: 'PIX',
        amountCents: 5000,
        dueDate: '2030-01-01',
        split: [{ walletId: fixture.walletId, percentageValue: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'SPLIT_TO_SELF' });
  });

  it('o cliente é vinculado ao agendamento e o hold segue HOLD até o pagamento', async () => {
    const fixture = await createFixture(admin, 'bind', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    await start(fixture, 'PIX');

    const booking = await bookingState(fixture.tenantId, fixture.bookingId);
    expect(booking?.customerId).toBe(fixture.customerMemberId);
    // A confirmação NÃO acontece no checkout: quem confirma é o webhook de pago.
    expect(booking?.status).toBe('HOLD');
  });

  // -------------------------------------------------------------------------
  // 2. Sinal (fixo e percentual)
  // -------------------------------------------------------------------------

  it('sinal por valor fixo: cobra o depósito, não o preço cheio', async () => {
    const fixture = await createFixture(admin, 'dep-fixed', {
      paymentMode: 'DEPOSIT',
      depositCents: 1500,
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'PIX');
    expect(result.kind).toBe('charge');
    if (result.kind !== 'charge') return;
    expect(result.amountCents).toBe(1500);
    expect(result.platformFeeCents).toBe(150);
  });

  it('sinal por percentual: 30% de 5000 = 1500 e cartão é recusado nessa modalidade', async () => {
    const fixture = await createFixture(admin, 'dep-pct', {
      paymentMode: 'DEPOSIT',
      depositPercent: 30,
      kycStatus: 'APPROVED',
    });
    const quote = await loadCheckoutQuote({
      ctx: await context(fixture.tenantId),
      holdId: fixture.bookingId,
      memberId: fixture.customerMemberId,
    });
    expect(quote.effectiveMode).toBe('DEPOSIT');
    expect(quote.chargeAmountCents).toBe(1500);

    await expect(start(fixture, 'CARD')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  // -------------------------------------------------------------------------
  // 3. No local
  // -------------------------------------------------------------------------

  it('no local: confirma sem cobrança', async () => {
    const fixture = await createFixture(admin, 'onsite', {
      paymentMode: 'ON_SITE',
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'PIX');
    expect(result).toMatchObject({ kind: 'on_site', degraded: false });

    const booking = await bookingState(fixture.tenantId, fixture.bookingId);
    expect(booking?.status).toBe('CONFIRMED');
    expect(await paymentFor(fixture.tenantId, fixture.bookingId)).toBeNull();
  });

  it('KYC pendente força ON_SITE e não trava o salão', async () => {
    const fixture = await createFixture(admin, 'kyc-pending', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'PENDING',
    });
    const result = await start(fixture, 'PIX');
    expect(result).toMatchObject({ kind: 'on_site', degraded: true });

    const booking = await bookingState(fixture.tenantId, fixture.bookingId);
    expect(booking?.status).toBe('CONFIRMED');
    expect(await paymentFor(fixture.tenantId, fixture.bookingId)).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 4. Webhook: pago, expirado, recusado e reentrega
  // -------------------------------------------------------------------------

  it('webhook de pagamento aprovado confirma o agendamento', async () => {
    const fixture = await createFixture(admin, 'paid', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'PIX');
    if (result.kind !== 'charge') throw new Error('esperava cobrança');
    const payment = await paymentFor(fixture.tenantId, fixture.bookingId);

    const response = await postWebhook(
      buildEvent('CHARGE_PAID', payment!.asaasId!, fixture.accountId, 5000),
    );

    expect(response.status).toBe(200);
    expect((await paymentFor(fixture.tenantId, fixture.bookingId))?.status).toBe('PAID');
    expect((await bookingState(fixture.tenantId, fixture.bookingId))?.status).toBe('CONFIRMED');
  });

  it('Pix expirado libera o slot', async () => {
    const fixture = await createFixture(admin, 'expire', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'PIX');
    if (result.kind !== 'charge') throw new Error('esperava cobrança');
    const payment = await paymentFor(fixture.tenantId, fixture.bookingId);

    await postWebhook(buildEvent('CHARGE_EXPIRED', payment!.asaasId!, fixture.accountId, 5000));

    expect((await paymentFor(fixture.tenantId, fixture.bookingId))?.status).toBe('EXPIRED');
    expect((await bookingState(fixture.tenantId, fixture.bookingId))?.status).toBe('CANCELLED');

    // O intervalo volta a aceitar outro agendamento do mesmo profissional.
    const blocking = await forTenant(fixture.tenantId, (tx) =>
      tx.booking.count({
        where: {
          staffId: fixture.staffId,
          status: { in: ['HOLD', 'PENDING', 'CONFIRMED'] },
        },
      }),
    );
    expect(blocking).toBe(0);
  });

  it('cartão recusado devolve o slot', async () => {
    const fixture = await createFixture(admin, 'refuse', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'CARD', {
      remoteIp: '8.8.8.8',
      card: {
        number: '4111111111111111',
        holderName: 'Cliente Teste',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
      },
    });
    expect(result.kind).toBe('charge');
    if (result.kind !== 'charge') return;
    expect(result.cardLast4).toBe('1111');

    const payment = await paymentFor(fixture.tenantId, fixture.bookingId);
    await postWebhook(buildEvent('CHARGE_REFUSED', payment!.asaasId!, fixture.accountId, 5000));

    expect((await paymentFor(fixture.tenantId, fixture.bookingId))?.status).toBe('FAILED');
    expect((await bookingState(fixture.tenantId, fixture.bookingId))?.status).toBe('CANCELLED');
  });

  it('reentrega do mesmo webhook não credita duas vezes', async () => {
    const fixture = await createFixture(admin, 'dup', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const result = await start(fixture, 'PIX');
    if (result.kind !== 'charge') throw new Error('esperava cobrança');
    const payment = await paymentFor(fixture.tenantId, fixture.bookingId);

    const event = buildEvent('CHARGE_PAID', payment!.asaasId!, fixture.accountId, 5000);
    const first = await postWebhook(event);
    const second = await postWebhook(event);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { duplicate?: boolean }).duplicate).toBe(true);

    const stored = await forTenant(fixture.tenantId, (tx) =>
      tx.payment.findFirst({ where: { bookingId: fixture.bookingId } }),
    );
    expect(stored?.status).toBe('PAID');
    const paymentCount = await forTenant(fixture.tenantId, (tx) =>
      tx.payment.count({ where: { bookingId: fixture.bookingId } }),
    );
    expect(paymentCount).toBe(1);
    const eventCount = await admin.asPlatformAdmin((tx) =>
      tx.webhookEvent.count({ where: { eventId: event.eventId } }),
    );
    expect(eventCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 5. Janela do hold
  // -------------------------------------------------------------------------

  it('cobrança fora da janela de 10 minutos é recusada', async () => {
    const fixture = await createFixture(admin, 'window', {
      paymentMode: 'FULL_PREPAID',
      kycStatus: 'APPROVED',
    });
    const ctx = await context(fixture.tenantId);
    await expect(
      startCheckout({
        ctx,
        holdId: fixture.bookingId,
        memberId: fixture.customerMemberId,
        method: 'PIX',
        now: new Date(Date.now() + 11 * 60_000),
      }),
    ).rejects.toBeInstanceOf(CheckoutError);
  });

  // -------------------------------------------------------------------------
  // 6. Configuração
  // -------------------------------------------------------------------------

  it('a taxa vem da configuração, nunca de número mágico', () => {
    expect(computePlatformFeeCents(5000)).toBe(PLATFORM_FEE_CENTS);
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '500');
    expect(computePlatformFeeCents(10_000)).toBe(500);
  });
});

describe('valores por modalidade', () => {
  it('integral usa o preço cheio; sinal usa fixo, senão percentual', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'FULL_PREPAID',
        depositCents: null,
        depositPercent: null,
      }),
    ).toBe(8000);
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'DEPOSIT',
        depositCents: 2000,
        depositPercent: 30,
      }),
    ).toBe(2000);
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'DEPOSIT',
        depositCents: null,
        depositPercent: 25,
      }),
    ).toBe(2000);
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'ON_SITE',
        depositCents: null,
        depositPercent: null,
      }),
    ).toBe(0);
  });
});
