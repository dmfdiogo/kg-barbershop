import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { TenantTransaction } from '@/lib/tenant/db';
import { getPaymentProvider } from './index';
import {
  PaymentProviderError,
  type KycStatus,
  type PaymentProvider,
} from './types';

/**
 * Conta de recebimento do estabelecimento (tarefa F4.1).
 *
 * A F2.5 já coleta o CPF/CNPJ (`Tenant.document`) e a chave Pix
 * (`OnboardingProgress.pixKey`); aqui essa coleta vira uma subconta no provedor
 * e uma linha em `AsaasAccount`.
 *
 * CHAVE DA SUBCONTA CRIPTOGRAFADA EM REPOUSO. A credencial que movimenta o
 * dinheiro do salão nunca é gravada em texto puro: `apiKeyEnc` guarda um
 * envelope (`envelope encryption`) em que uma DEK aleatória cifra a chave e a
 * chave da aplicação (`PAYMENTS_ENCRYPTION_KEY`) cifra a DEK. Se o banco
 * vazar, vaza dado cifrado — não a conta do estabelecimento.
 *
 * CAMINHO DEGRADADO OBRIGATÓRIO. Um cadastro `PENDING`/`REJECTED` não pode
 * virar um salão que não consegue usar o sistema: `resolveReceivingCapability`
 * marca `online: false` e `effectivePaymentMode` rebaixa qualquer modalidade
 * para `ON_SITE` (pagamento no balcão). O salão continua vendendo enquanto o
 * KYC não passa.
 *
 * REENTRÂNCIA. A criação da subconta é uma chamada EXTERNA e por isso acontece
 * FORA da transação escopada — dentro da callback do client escopado só pode
 * viver banco, que é reexecutável sob retry. Lemos os dados num `forTenant`,
 * chamamos o provider, e persistimos noutro `forTenant`.
 */

// ---------------------------------------------------------------------------
// Criptografia de envelope
// ---------------------------------------------------------------------------

export const ENCRYPTION_ENV_VAR = 'PAYMENTS_ENCRYPTION_KEY';

const ENVELOPE_VERSION = 'v1';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const DEV_FALLBACK_SECRET = 'kg-dev-payments-encryption';
const DEV_FALLBACK_SALT = 'kg-payments-encryption-salt';

/**
 * Chave-mestra da aplicação (KEK). Em produção é obrigatória e precisa ser
 * base64 de 32 bytes; em desenvolvimento há um fallback determinístico para
 * que a suíte rode em máquina limpa sem `.env` novo — o mesmo critério do
 * `AUTH_SESSION_SECRET`. Um fallback fixo JAMAIS vale em produção: quem vazar o
 * código não pode decifrar a carteira de ninguém.
 */
let cachedKey: Buffer | undefined;

export function getApplicationEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env[ENCRYPTION_ENV_VAR]?.trim();
  if (raw) {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length !== KEY_BYTES) {
      throw new Error(
        `${ENCRYPTION_ENV_VAR} inválida: esperado base64 de ${KEY_BYTES} bytes (${KEY_BYTES * 8} bits).`,
      );
    }
    cachedKey = decoded;
    return decoded;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${ENCRYPTION_ENV_VAR} não configurada. Em produção a chave de criptografia do recebimento é obrigatória.`,
    );
  }

  cachedKey = scryptSync(DEV_FALLBACK_SECRET, DEV_FALLBACK_SALT, KEY_BYTES);
  return cachedKey;
}

/** Só para testes que trocam a chave em runtime. */
export function resetApplicationEncryptionKeyCache(): void {
  cachedKey = undefined;
}

function sealWithKey(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

function openWithKey(key: Buffer, sealed: string): Buffer {
  const parts = sealed.split('.');
  if (parts.length !== 3) {
    throw new Error('Envelope cifrado corrompido.');
  }
  const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new Error('Envelope cifrado corrompido.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Cifra um segredo com envelope: DEK aleatória por segredo, DEK embrulhada pela
 * chave da aplicação. Duas cifragens do MESMO texto produzem saídas diferentes
 * (IV e DEK aleatórios), então comparar ciphertexts não revela repetição.
 *
 * Formato: `v1.<dekIv>.<dekTag>.<dekCt>.<iv>.<tag>.<ct>` (base64 por segmento).
 */
export function encryptSecret(plaintext: string): string {
  const dek = randomBytes(KEY_BYTES);
  const wrappedDek = sealWithKey(getApplicationEncryptionKey(), dek);
  const sealed = sealWithKey(dek, Buffer.from(plaintext, 'utf8'));
  return `${ENVELOPE_VERSION}.${wrappedDek}.${sealed}`;
}

/** Decifra um envelope produzido por `encryptSecret`. Lança se adulterado. */
export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 7 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error('Envelope cifrado em formato desconhecido.');
  }
  const wrappedDek = parts.slice(1, 4).join('.');
  const sealed = parts.slice(4, 7).join('.');
  const dek = openWithKey(getApplicationEncryptionKey(), wrappedDek);
  if (dek.length !== KEY_BYTES) {
    throw new Error('Envelope cifrado corrompido.');
  }
  return openWithKey(dek, sealed).toString('utf8');
}

export function isEncryptedSecret(payload: string): boolean {
  return payload.startsWith(`${ENVELOPE_VERSION}.`) && payload.split('.').length === 7;
}

// ---------------------------------------------------------------------------
// Conta e KYC
// ---------------------------------------------------------------------------

export type ReceivingUnavailableReason = 'NO_ACCOUNT' | 'KYC_PENDING' | 'KYC_REJECTED';

export interface MerchantAccountView {
  accountId: string;
  walletId: string;
  pixKey: string;
  kycStatus: KycStatus;
  createdAt: string;
}

/**
 * O que o salão consegue fazer com o recebimento AGORA. `online: false` é o
 * caminho degradado — nunca erro, nunca bloqueio do restante do sistema.
 */
export interface ReceivingCapability {
  online: boolean;
  kycStatus: KycStatus | null;
  reason: 'ACTIVE' | ReceivingUnavailableReason;
  account: MerchantAccountView | null;
  /** Frase para o painel explicar a situação atual. */
  summary: string;
  /** O que falta fazer; `null` quando nada falta. */
  requirement: string | null;
}

/** Executa uma callback no client escopado do tenant informado. */
export interface MerchantAccountDb {
  forTenant<T>(
    tenantId: string,
    fn: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T>;
}

export class MerchantAccountError extends Error {
  constructor(
    readonly code: 'PIX_KEY_MISSING' | 'ACCOUNT_NOT_CREATED',
    message: string,
  ) {
    super(message);
    this.name = 'MerchantAccountError';
  }
}

export interface MerchantServiceOptions {
  /** Injetável em teste; o produto usa a factory por env. */
  provider?: PaymentProvider;
}

const ACCOUNT_SELECT = {
  asaasAccountId: true,
  walletId: true,
  pixKey: true,
  kycStatus: true,
  createdAt: true,
} as const;

type AccountRow = {
  asaasAccountId: string;
  walletId: string;
  pixKey: string;
  kycStatus: KycStatus;
  createdAt: Date;
};

function toView(row: AccountRow): MerchantAccountView {
  return {
    accountId: row.asaasAccountId,
    walletId: row.walletId,
    pixKey: row.pixKey,
    kycStatus: row.kycStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadMerchantAccount(
  tx: TenantTransaction,
  tenantId: string,
): Promise<MerchantAccountView | null> {
  const row = await tx.asaasAccount.findUnique({
    where: { tenantId },
    select: ACCOUNT_SELECT,
  });
  return row ? toView(row) : null;
}

export async function loadReceivingCapability(
  db: MerchantAccountDb,
  tenantId: string,
): Promise<ReceivingCapability> {
  const account = await db.forTenant(tenantId, (tx) =>
    loadMerchantAccount(tx, tenantId),
  );
  return resolveReceivingCapability(account);
}

/**
 * Decisão PURA do caminho degradado, derivada do estado persistido. KYC
 * diferente de `APPROVED` — inclusive ausência de conta — mantém o salão
 * funcionando em `ON_SITE`.
 */
export function resolveReceivingCapability(
  account: MerchantAccountView | null,
): ReceivingCapability {
  if (!account) {
    return {
      online: false,
      kycStatus: null,
      reason: 'NO_ACCOUNT',
      account: null,
      summary:
        'Conta de recebimento ainda não criada. Seus agendamentos continuam funcionando com pagamento no local.',
      requirement: 'Criar a conta de recebimento.',
    };
  }

  switch (account.kycStatus) {
    case 'APPROVED':
      return {
        online: true,
        kycStatus: account.kycStatus,
        reason: 'ACTIVE',
        account,
        summary: 'Recebimento online ativo: Pix e cartão liberados no seu portal.',
        requirement: null,
      };
    case 'PENDING':
      return {
        online: false,
        kycStatus: account.kycStatus,
        reason: 'KYC_PENDING',
        account,
        summary:
          'Cadastro em análise pelo provedor. Enquanto isso, seus agendamentos funcionam com pagamento no local.',
        requirement: 'Aguardar a aprovação do cadastro. Nada precisa ser feito agora.',
      };
    case 'REJECTED':
      return {
        online: false,
        kycStatus: account.kycStatus,
        reason: 'KYC_REJECTED',
        account,
        summary:
          'Cadastro recusado pelo provedor. Seus agendamentos continuam funcionando com pagamento no local.',
        requirement:
          'Revise os dados do estabelecimento e da chave Pix e tente criar a conta novamente.',
      };
  }
}

export type EffectivePaymentMode = 'FULL_PREPAID' | 'DEPOSIT' | 'ON_SITE';

/**
 * Modalidade efetiva do serviço. Sem recebimento online aprovado, qualquer
 * cobrança antecipada cai para `ON_SITE` em vez de falhar no checkout. É o
 * mesmo rebaixamento que o checkout da F4.2 deve consultar.
 */
export function effectivePaymentMode(
  baseMode: EffectivePaymentMode,
  capability: Pick<ReceivingCapability, 'online'>,
): EffectivePaymentMode {
  return capability.online ? baseMode : 'ON_SITE';
}

/**
 * Cria a subconta do estabelecimento e a persiste cifrada.
 *
 * Idempotente por `AsaasAccount.tenantId` único: chamar de novo devolve a conta
 * existente sem tocar no provedor.
 */
export async function createMerchantAccount(
  db: MerchantAccountDb,
  tenantId: string,
  options: MerchantServiceOptions = {},
): Promise<MerchantAccountView> {
  const existing = await db.forTenant(tenantId, (tx) =>
    loadMerchantAccount(tx, tenantId),
  );
  if (existing) return existing;

  // Dados coletados na F2.5. Leitura escopada e sequencial (o adapter-pg não
  // gosta de queries concorrentes na mesma transação interativa).
  const onboarding = await db.forTenant(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, document: true },
    });
    const progress = await tx.onboardingProgress.findUnique({
      where: { tenantId },
      select: { pixKey: true },
    });
    return { ...tenant, pixKey: progress?.pixKey ?? null };
  });

  if (!onboarding.pixKey || onboarding.pixKey.trim().length === 0) {
    throw new MerchantAccountError(
      'PIX_KEY_MISSING',
      'Informe a chave Pix do estabelecimento no onboarding antes de ativar o recebimento.',
    );
  }
  const pixKey = onboarding.pixKey.trim();

  // Chamada EXTERNA, fora da transação escopada: a callback pode ser
  // reexecutada sob retry e nada fora do banco pode morar lá dentro.
  const provider = options.provider ?? getPaymentProvider();
  const created = await provider.createMerchantAccount({
    name: onboarding.name,
    document: onboarding.document,
    pixKey,
  });

  const apiKey = resolveSubaccountApiKey(created);
  const apiKeyEnc = encryptSecret(apiKey);

  try {
    return await db.forTenant(tenantId, async (tx) => {
      const row = await tx.asaasAccount.create({
        data: {
          tenantId,
          asaasAccountId: created.accountId,
          walletId: created.walletId,
          apiKeyEnc,
          pixKey,
          kycStatus: created.kycStatus,
        },
        select: ACCOUNT_SELECT,
      });
      return toView(row);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Corrida: outra requisição criou entre a leitura e o insert. A conta é
      // única por tenant; devolver a vencedora é o resultado idempotente.
      const raced = await db.forTenant(tenantId, (tx) =>
        loadMerchantAccount(tx, tenantId),
      );
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * A chave da subconta vem do provedor quando ele a devolve (o Asaas real expõe
 * `apiKey` na criação). O mock da F0.3 ainda não a devolve; nesse caso geramos
 * uma credencial local — o que importa para a F4.1 é que ela é cifrada antes de
 * tocar o banco.
 */
function resolveSubaccountApiKey(created: {
  accountId: string;
  apiKey?: unknown;
}): string {
  const provided = created.apiKey;
  if (typeof provided === 'string' && provided.trim().length > 0) {
    return provided.trim();
  }
  return `sk_mock_${created.accountId}_${randomUUID()}`;
}

export function isMerchantProviderError(error: unknown): error is PaymentProviderError {
  return error instanceof PaymentProviderError;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return meta?.code === 'P2002' || meta?.code === '23505';
}
