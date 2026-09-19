// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMerchantAccount,
  decryptSecret,
  effectivePaymentMode,
  isEncryptedSecret,
  loadReceivingCapability,
  MerchantAccountError,
} from '@/lib/payments/merchant';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore } from '@/lib/payments/mock-store';
import { parsePaymentWebhookEvent } from '@/lib/payments/webhook';
import { processPaymentWebhook } from '@/app/api/webhooks/payments/processor';
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
 * Conta de recebimento (tarefa F4.1) com Postgres real e a role SEM superuser.
 *
 * O que este arquivo prova:
 *   - a chave da subconta é gravada CIFRADA: um "dump" da linha não revela o
 *     texto puro;
 *   - o KYC reflete o que o provedor devolve: `simulateKycDecision` dispara o
 *     webhook e o `AsaasAccount.kycStatus` acompanha;
 *   - KYC pendente/recusado NÃO trava o salão — a modalidade cai para ON_SITE;
 *   - isolamento: B não enxerga nem lê a conta de A.
 */

const PIX_KEY_A = 'carlos@exemplo.com.br';
const PIX_KEY_B = '+5548900000900';

describe('conta de recebimento — F4.1', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let a: TenantFixture;
  let b: TenantFixture;
  let noPix: TenantFixture;
  let provider: MockPaymentProvider;
  const deliveredEventIds: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    a = await createTenantFixture(admin, 'merchant-a');
    b = await createTenantFixture(admin, 'merchant-b');
    noPix = await createTenantFixture(admin, 'merchant-nopix');

    await admin.asPlatformAdmin(async (tx) => {
      await tx.onboardingProgress.create({
        data: { tenantId: a.tenantId, pixKey: PIX_KEY_A },
      });
      await tx.onboardingProgress.create({
        data: { tenantId: b.tenantId, pixKey: PIX_KEY_B },
      });
      // `noPix` fica de propósito sem OnboardingProgress/pixKey.
    });

    provider = new MockPaymentProvider({
      store: createMockPaymentStore(),
      // O webhook do mock bate na rota real; aqui injetamos o transporte para o
      // núcleo persistente, como o fariam os testes de HTTP.
      transport: {
        async deliver(request) {
          const event = parsePaymentWebhookEvent(request.body);
          if (!event) return { ok: false, status: 400 };
          const result = await processPaymentWebhook(event, request.body);
          return { ok: result.status === 200, status: result.status };
        },
      },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: 'integration-secret',
    });
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      const eventIds = [...deliveredEventIds];
      if (eventIds.length > 0) {
        await admin.asPlatformAdmin((tx) =>
          tx.webhookEvent.deleteMany({ where: { eventId: { in: eventIds } } }),
        );
      }
      if (a) await deleteTenant(admin, a.tenantId);
      if (b) await deleteTenant(admin, b.tenantId);
      if (noPix) await deleteTenant(admin, noPix.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  it('persiste a chave cifrada e um dump da linha não revela o texto puro', async () => {
    const account = await createMerchantAccount(scoped, a.tenantId, { provider });
    expect(account.accountId).toMatch(/^acc_mock_/);
    expect(account.kycStatus).toBe('PENDING');
    expect(account.pixKey).toBe(PIX_KEY_A);

    const raw = await admin.asPlatformAdmin((tx) =>
      tx.asaasAccount.findUniqueOrThrow({
        where: { tenantId: a.tenantId },
        select: {
          asaasAccountId: true,
          walletId: true,
          apiKeyEnc: true,
          pixKey: true,
          kycStatus: true,
        },
      }),
    );

    // Modela o "dump do banco": o serializado inteiro da linha não contém a
    // chave em claro.
    const dump = JSON.stringify(raw);
    expect(isEncryptedSecret(raw.apiKeyEnc)).toBe(true);
    const plaintext = decryptSecret(raw.apiKeyEnc);
    expect(plaintext.startsWith('sk_mock_')).toBe(true);
    expect(dump).not.toContain(plaintext);
    expect(dump).not.toContain('sk_mock_');

    // Idempotente: chamar de novo devolve a mesma conta, sem criar outra linha.
    const again = await createMerchantAccount(scoped, a.tenantId, { provider });
    expect(again.accountId).toBe(account.accountId);
    const rows = await admin.asPlatformAdmin((tx) =>
      tx.asaasAccount.count({ where: { tenantId: a.tenantId } }),
    );
    expect(rows).toBe(1);
  });

  it('KYC pendente opera em ON_SITE; aprovação e recusa do provedor refletem no estado', async () => {
    const account = await createMerchantAccount(scoped, b.tenantId, { provider });

    const pending = await loadReceivingCapability(scoped, b.tenantId);
    expect(pending.online).toBe(false);
    expect(pending.reason).toBe('KYC_PENDING');
    expect(effectivePaymentMode('FULL_PREPAID', pending)).toBe('ON_SITE');

    const approved = await provider.simulateKycDecision(account.accountId, 'APPROVED');
    deliveredEventIds.push(approved.eventId);
    expect(approved.delivered).toBe(true);

    const online = await loadReceivingCapability(scoped, b.tenantId);
    expect(online.kycStatus).toBe('APPROVED');
    expect(online.online).toBe(true);
    expect(effectivePaymentMode('FULL_PREPAID', online)).toBe('FULL_PREPAID');

    const rejected = await provider.simulateKycDecision(account.accountId, 'REJECTED');
    deliveredEventIds.push(rejected.eventId);
    expect(rejected.delivered).toBe(true);

    const offline = await loadReceivingCapability(scoped, b.tenantId);
    expect(offline.kycStatus).toBe('REJECTED');
    expect(offline.online).toBe(false);
    expect(offline.reason).toBe('KYC_REJECTED');
    expect(effectivePaymentMode('FULL_PREPAID', offline)).toBe('ON_SITE');
    expect(offline.requirement).toBeTruthy();
  });

  it('sem chave Pix, recusa e não cria conta', async () => {
    await expect(
      createMerchantAccount(scoped, noPix.tenantId, { provider }),
    ).rejects.toMatchObject({
      code: 'PIX_KEY_MISSING',
    } satisfies Partial<MerchantAccountError>);

    const rows = await admin.asPlatformAdmin((tx) =>
      tx.asaasAccount.count({ where: { tenantId: noPix.tenantId } }),
    );
    expect(rows).toBe(0);
  });

  it('isolamento: B não enxerga a conta de A', async () => {
    const accountA = await admin.asPlatformAdmin((tx) =>
      tx.asaasAccount.findUniqueOrThrow({
        where: { tenantId: a.tenantId },
        select: { asaasAccountId: true },
      }),
    );

    const capabilityB = await loadReceivingCapability(scoped, b.tenantId);
    // B tem a própria conta (criada no teste anterior), nunca a de A.
    if (capabilityB.account) {
      expect(capabilityB.account.accountId).not.toBe(accountA.asaasAccountId);
    }

    const visibleToB = await scoped.forTenant(b.tenantId, (tx) =>
      tx.asaasAccount.findMany({ select: { asaasAccountId: true } }),
    );
    expect(visibleToB.some((row) => row.asaasAccountId === accountA.asaasAccountId)).toBe(false);
  });
});
