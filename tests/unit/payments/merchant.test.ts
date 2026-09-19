// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MockPaymentProvider } from '@/lib/payments/mock';
import { createMockPaymentStore } from '@/lib/payments/mock-store';
import {
  createMerchantAccount,
  decryptSecret,
  effectivePaymentMode,
  encryptSecret,
  isEncryptedSecret,
  MerchantAccountError,
  resolveReceivingCapability,
  type MerchantAccountDb,
  type MerchantAccountView,
} from '@/lib/payments/merchant';
import type { TenantTransaction } from '@/lib/tenant/db';

/**
 * Criptografia de envelope e caminho degradado (tarefa F4.1), sem Postgres.
 *
 * A prova que importa aqui é comportamental: a chave da subconta nunca aparece
 * em texto no payload persistido, e KYC diferente de aprovado rebaixa a
 * modalidade para `ON_SITE` em vez de travar o salão.
 */

describe('criptografia da chave da subconta', () => {
  it('cifra e decifra de volta ao texto original', () => {
    const plaintext = 'sk_live_abc123_uma_chave_de_verdade';
    const enveloped = encryptSecret(plaintext);
    expect(enveloped).not.toBe(plaintext);
    expect(enveloped).not.toContain(plaintext);
    expect(isEncryptedSecret(enveloped)).toBe(true);
    expect(decryptSecret(enveloped)).toBe(plaintext);
  });

  it('duas cifragens do mesmo texto produzem saídas diferentes (DEK e IV aleatórios)', () => {
    const a = encryptSecret('mesma-chave');
    const b = encryptSecret('mesma-chave');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('mesma-chave');
    expect(decryptSecret(b)).toBe('mesma-chave');
  });

  it('recusa envelope adulterado', () => {
    const enveloped = encryptSecret('segredo');
    const tampered = `${enveloped.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('recusa formato desconhecido', () => {
    expect(() => decryptSecret('texto-puro')).toThrow();
  });
});

describe('resolveReceivingCapability', () => {
  function account(kycStatus: MerchantAccountView['kycStatus']): MerchantAccountView {
    return {
      accountId: 'acc_1',
      walletId: 'wallet_1',
      pixKey: 'pix@exemplo.com',
      kycStatus,
      createdAt: new Date().toISOString(),
    };
  }

  it('sem conta: opera em ON_SITE e diz o que falta', () => {
    const capability = resolveReceivingCapability(null);
    expect(capability.online).toBe(false);
    expect(capability.reason).toBe('NO_ACCOUNT');
    expect(capability.requirement).toBeTruthy();
    expect(effectivePaymentMode('FULL_PREPAID', capability)).toBe('ON_SITE');
    expect(effectivePaymentMode('DEPOSIT', capability)).toBe('ON_SITE');
    expect(effectivePaymentMode('ON_SITE', capability)).toBe('ON_SITE');
  });

  it('KYC PENDENTE não trava o salão', () => {
    const capability = resolveReceivingCapability(account('PENDING'));
    expect(capability.online).toBe(false);
    expect(capability.reason).toBe('KYC_PENDING');
    expect(capability.summary).toMatch(/pagamento no local/i);
    expect(effectivePaymentMode('FULL_PREPAID', capability)).toBe('ON_SITE');
  });

  it('KYC REPROVADO não trava o salão', () => {
    const capability = resolveReceivingCapability(account('REJECTED'));
    expect(capability.online).toBe(false);
    expect(capability.reason).toBe('KYC_REJECTED');
    expect(capability.requirement).toBeTruthy();
    expect(effectivePaymentMode('FULL_PREPAID', capability)).toBe('ON_SITE');
  });

  it('KYC aprovado libera a modalidade original', () => {
    const capability = resolveReceivingCapability(account('APPROVED'));
    expect(capability.online).toBe(true);
    expect(capability.reason).toBe('ACTIVE');
    expect(capability.requirement).toBeNull();
    expect(effectivePaymentMode('FULL_PREPAID', capability)).toBe('FULL_PREPAID');
    expect(effectivePaymentMode('DEPOSIT', capability)).toBe('DEPOSIT');
  });
});

interface FakeState {
  account: {
    asaasAccountId: string;
    walletId: string;
    pixKey: string;
    kycStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    createdAt: Date;
  } | null;
  pixKey: string | null;
  created: { apiKeyEnc: string } | null;
}

function createFakeDb(state: FakeState): MerchantAccountDb {
  const tx = {
    asaasAccount: {
      findUnique: vi.fn(async () => state.account),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.created = { apiKeyEnc: String(data.apiKeyEnc) };
        const row = {
          asaasAccountId: String(data.asaasAccountId),
          walletId: String(data.walletId),
          pixKey: String(data.pixKey),
          kycStatus: data.kycStatus as 'PENDING' | 'APPROVED' | 'REJECTED',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        state.account = row;
        return row;
      }),
    },
    tenant: {
      findUniqueOrThrow: vi.fn(async () => ({
        name: 'Barbearia Teste',
        document: '12345678909',
      })),
    },
    onboardingProgress: {
      findUnique: vi.fn(async () => (state.pixKey ? { pixKey: state.pixKey } : null)),
    },
  } as unknown as TenantTransaction;

  return { forTenant: (_tenantId, fn) => fn(tx) };
}

function fakeProvider() {
  return new MockPaymentProvider({
    store: createMockPaymentStore(),
    transport: { deliver: async () => ({ ok: true, status: 200 }) },
    webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
    webhookSecret: 'unit-secret',
  });
}

describe('createMerchantAccount', () => {
  it('persiste a chave cifrada — o texto puro não aparece no payload', async () => {
    const state: FakeState = { account: null, pixKey: 'pix@exemplo.com', created: null };
    const view = await createMerchantAccount(createFakeDb(state), 'tenant-1', {
      provider: fakeProvider(),
    });

    expect(view.kycStatus).toBe('PENDING');
    expect(state.created).not.toBeNull();
    const stored = state.created!.apiKeyEnc;
    expect(isEncryptedSecret(stored)).toBe(true);
    const plaintext = decryptSecret(stored);
    expect(plaintext.startsWith('sk_mock_')).toBe(true);
    expect(stored).not.toContain(plaintext);
  });

  it('sem chave Pix, recusa antes de tocar no provedor', async () => {
    const state: FakeState = { account: null, pixKey: null, created: null };
    await expect(
      createMerchantAccount(createFakeDb(state), 'tenant-1', { provider: fakeProvider() }),
    ).rejects.toMatchObject({ code: 'PIX_KEY_MISSING' } satisfies Partial<MerchantAccountError>);
    expect(state.created).toBeNull();
  });

  it('é idempotente: com conta existente, não cria de novo', async () => {
    const state: FakeState = {
      account: {
        asaasAccountId: 'acc_existente',
        walletId: 'wallet_existente',
        pixKey: 'pix@exemplo.com',
        kycStatus: 'APPROVED',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      pixKey: 'pix@exemplo.com',
      created: null,
    };
    const view = await createMerchantAccount(createFakeDb(state), 'tenant-1', {
      provider: fakeProvider(),
    });
    expect(view.accountId).toBe('acc_existente');
    expect(state.created).toBeNull();
  });
});
