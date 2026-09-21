import {
  PaymentProviderError,
  type Charge,
  type ChargeStatus,
  type KycStatus,
  type MerchantAccount,
  type NewCardToken,
  type NewCharge,
  type NewMerchant,
  type NewSubscription,
  type PaymentProvider,
  type Refund,
  type Split,
  type Subscription,
  type SubscriptionCycle,
} from './types';

/**
 * Adaptador real do `PaymentProvider` contra o Asaas (tarefa F8.2).
 *
 * A REGRA QUE SUSTENTA O NEGÓCIO: a cobrança NASCE NA SUBCONTA DO SALÃO, e o
 * split leva apenas a taxa para a carteira da plataforma. Cobrar na conta da
 * plataforma e repassar depois transformaria o faturamento de todos os salões
 * em receita nossa perante a Receita Federal, e nos colocaria exercendo
 * atividade de instituição de pagamento. Por isso `accountId` nunca é opcional
 * e nunca cai para a conta-pai.
 *
 * COMO A CHAVE DA SUBCONTA CHEGA AQUI. O Asaas identifica a conta pela CHAVE,
 * não por um parâmetro: não existe cabeçalho "agir como a subconta X". A chave
 * da subconta é devolvida UMA ÚNICA VEZ, na criação, e o produto a guarda em
 * `AsaasAccount.apiKeyEnc`. Um port não fala com o banco, então quem constrói
 * o adaptador injeta `resolveAccountKey`. Sem ele, qualquer operação escopada
 * em subconta falha com mensagem explícita em vez de silenciosamente usar a
 * conta da plataforma — que é o erro que arruinaria o modelo fiscal.
 *
 * DESCOBERTAS CONTRA O SANDBOX, que a documentação não traz:
 *
 *  - O SPLIT INCIDE SOBRE O LÍQUIDO. Cobrança de R$ 50,00 com taxa de R$ 0,99
 *    tem líquido de R$ 49,01, e um split de 10% resulta em R$ 4,90 — não R$
 *    5,00. Por isso `Charge.split` devolve o `totalValue` que o provedor
 *    calculou, e não o que pedimos: o repasse real é o dele, não o nosso.
 *  - A SUBCONTA NASCE SEM CHAVE PIX. Cobrança Pix numa conta sem chave falha;
 *    `createMerchantAccount` cria uma EVP logo após provisionar, senão o salão
 *    é aprovado no KYC e mesmo assim não consegue receber.
 *  - HÁ LIMITE DE CONSULTAS AGRESSIVO nas rotas de provisionamento; daí o
 *    retry com espera em `postWithRetry`.
 */

const DEFAULT_BASE_URL = 'https://api-sandbox.asaas.com/v3';

export interface AsaasProviderOptions {
  /** Chave da conta-pai (plataforma). Padrão: `ASAAS_API_KEY`. */
  apiKey?: string;
  baseUrl?: string;
  /**
   * Devolve a chave de API da subconta. Injetado por quem tem acesso ao
   * `AsaasAccount`; o port não fala com o banco.
   */
  resolveAccountKey?: (accountId: string) => Promise<string>;
  /**
   * Dados do pagador. O ASAAS EXIGE CPF/CNPJ para emitir cobrança — nem Pix
   * nem cartão saem sem ele. O nosso `User` guarda telefone e nome, e nada
   * mais, então hoje ninguém sabe esse número: coletá-lo é mudança de produto
   * (campo no checkout e coluna no schema), não de adaptador. Fica injetado
   * para que o dia em que o dado existir seja uma linha de fiação.
   */
  resolvePayer?: (customerId: string) => Promise<PayerIdentity>;
  fetchImpl?: typeof fetch;
  /** Injetável em teste para não dormir de verdade. */
  sleep?: (ms: number) => Promise<void>;
}

/** Identidade mínima que o Asaas exige do pagador. */
export interface PayerIdentity {
  name: string;
  /** CPF ou CNPJ, só dígitos. Obrigatório pelo provedor. */
  document: string;
  email?: string;
  phone?: string;
}

interface AsaasError {
  code?: string;
  description?: string;
}

/**
 * A chave do Asaas começa com `$`, e o `.env` a guarda escapada porque o Next
 * expande variáveis ao carregar. Quem lê fora do Next recebe a barra e
 * precisa removê-la — sem isto o provedor devolve 401 e a culpa parece ser da
 * chave.
 */
function unescapeKey(value: string): string {
  return value.replace(/\\\$/g, '$');
}

function centsToReais(cents: number): number {
  return Math.round(cents) / 100;
}

function reaisToCents(value: number): number {
  return Math.round(value * 100);
}

/** Tradução dos erros do Asaas para o vocabulário do produto. */
function translate(status: number, errors: AsaasError[]): PaymentProviderError {
  const first = errors[0];
  const description = first?.description ?? `Asaas devolveu ${status}.`;
  const text = description.toLowerCase();

  if (text.includes('própria carteira')) {
    return new PaymentProviderError('SPLIT_TO_SELF', description);
  }
  if (text.includes('wallet') && text.includes('inexistente')) {
    return new PaymentProviderError('INVALID_SPLIT', description);
  }
  if (text.includes('conta precisa estar aprovada') || text.includes('não está disponível')) {
    return new PaymentProviderError('KYC_NOT_APPROVED', description);
  }
  if (text.includes('chave pix')) {
    return new PaymentProviderError('KYC_NOT_APPROVED', description);
  }
  if (status === 404) {
    return new PaymentProviderError('CHARGE_NOT_FOUND', description);
  }
  if (status === 401 || status === 403) {
    return new PaymentProviderError('ACCOUNT_NOT_FOUND', description);
  }
  return new PaymentProviderError('VALIDATION', description);
}

const STATUS_MAP: Record<string, ChargeStatus> = {
  PENDING: 'PENDING',
  AWAITING_RISK_ANALYSIS: 'PENDING',
  CONFIRMED: 'PAID',
  RECEIVED: 'PAID',
  RECEIVED_IN_CASH: 'PAID',
  OVERDUE: 'EXPIRED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
  REFUND_REQUESTED: 'REFUNDED',
  CHARGEBACK_REQUESTED: 'REFUSED',
  CHARGEBACK_DISPUTE: 'REFUSED',
  AWAITING_CHARGEBACK_REVERSAL: 'REFUSED',
  DUNNING_REQUESTED: 'PENDING',
  DUNNING_RECEIVED: 'PAID',
  CANCELED: 'REFUSED',
};

const CYCLE_MAP: Record<SubscriptionCycle, string> = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
};

export class AsaasPaymentProvider implements PaymentProvider {
  private readonly platformKey: string;
  private readonly baseUrl: string;
  private readonly resolveAccountKey: (accountId: string) => Promise<string>;
  private readonly resolvePayer: (customerId: string) => Promise<PayerIdentity>;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AsaasProviderOptions = {}) {
    const key = options.apiKey ?? process.env.ASAAS_API_KEY;
    if (!key) {
      throw new Error('ASAAS_API_KEY não definida; PAYMENT_PROVIDER=asaas exige a chave.');
    }
    this.platformKey = unescapeKey(key.trim());
    this.baseUrl = (options.baseUrl ?? process.env.ASAAS_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      '',
    );
    this.doFetch = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.resolveAccountKey =
      options.resolveAccountKey ??
      (async (accountId) => {
        throw new PaymentProviderError(
          'ACCOUNT_NOT_FOUND',
          `Sem resolvedor de chave para a subconta ${accountId}. ` +
            'Injete `resolveAccountKey` ao construir o provider — cobrar pela conta da ' +
            'plataforma quebraria o modelo fiscal.',
        );
      });
    this.resolvePayer =
      options.resolvePayer ??
      (async (customerId) => {
        throw new PaymentProviderError(
          'VALIDATION',
          `Sem CPF/CNPJ para o pagador ${customerId}. O Asaas não emite cobrança sem ` +
            'esse dado, e o produto ainda não o coleta — injete `resolvePayer`.',
        );
      });
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; key?: string } = {},
  ): Promise<T> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: {
        access_token: init.key ?? this.platformKey,
        'Content-Type': 'application/json',
        'User-Agent': 'bom-horario',
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      throw translate(response.status, (data.errors as AsaasError[]) ?? []);
    }
    return data as T;
  }

  /**
   * POST com retry para as rotas de provisionamento. O Asaas devolve
   * "serviço temporariamente indisponível devido a excesso de consultas" sob
   * carga — observado criando chave Pix, que precisou de três tentativas.
   */
  private async postWithRetry<T>(
    path: string,
    body: unknown,
    key?: string,
    attempts = 4,
  ): Promise<T> {
    let last: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await this.request<T>(path, { body, ...(key ? { key } : {}) });
      } catch (error) {
        const busy =
          error instanceof PaymentProviderError && /excesso de consultas/i.test(error.message);
        if (!busy) throw error;
        last = error;
        await this.sleep(2000 * (i + 1));
      }
    }
    throw last;
  }

  // -------------------------------------------------------------------------
  // Subconta do estabelecimento
  // -------------------------------------------------------------------------

  async createMerchantAccount(
    input: NewMerchant,
  ): Promise<{ accountId: string; walletId: string; kycStatus: KycStatus }> {
    const created = await this.postWithRetry<{
      id: string;
      walletId: string;
      apiKey?: string;
    }>('/accounts', {
      name: input.name,
      email: input.email,
      cpfCnpj: input.document,
      mobilePhone: input.phone,
      // O Asaas exige `companyType` quando o documento é CNPJ; para CPF ele
      // precisa estar ausente.
      ...(input.document.replace(/\D/g, '').length === 14 ? { companyType: 'LIMITED' } : {}),
    });

    // A subconta nasce SEM chave Pix, e sem ela não recebe por Pix — o salão
    // ficaria aprovado no KYC e mesmo assim sem conseguir cobrar. A chave EVP
    // é aleatória e não exige comprovação de posse.
    if (created.apiKey) {
      try {
        await this.postWithRetry('/pix/addressKeys', { type: 'EVP' }, created.apiKey);
      } catch (error) {
        console.error(
          `[asaas] subconta ${created.id} criada sem chave Pix; ela não receberá por Pix até que uma seja criada.`,
          error,
        );
      }
    }

    const account = await this.getMerchantAccount(created.id);
    return { accountId: created.id, walletId: created.walletId, kycStatus: account.kycStatus };
  }

  async getMerchantAccount(accountId: string): Promise<MerchantAccount> {
    const key = await this.resolveAccountKey(accountId);
    const [me, status, wallets] = await Promise.all([
      this.request<{ name?: string; cpfCnpj?: string; dateCreated?: string }>('/myAccount', { key }),
      this.request<{ general?: string }>('/myAccount/status', { key }),
      this.request<{ data: { id: string }[] }>('/wallets', { key }),
    ]);

    const general = status.general ?? 'PENDING';
    const kycStatus: KycStatus =
      general === 'APPROVED' ? 'APPROVED' : general === 'REJECTED' ? 'REJECTED' : 'PENDING';

    return {
      accountId,
      walletId: wallets.data[0]?.id ?? '',
      name: me.name ?? '',
      document: me.cpfCnpj ?? '',
      kycStatus,
      createdAt: me.dateCreated ?? new Date().toISOString(),
    };
  }

  async getBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }> {
    const key = await this.resolveAccountKey(accountId);
    const [balance, statistics] = await Promise.all([
      this.request<{ balance: number }>('/finance/balance', { key }),
      this.request<{ quantity?: number; value?: number }>(
        '/finance/payment/statistics?status=PENDING',
        { key },
      ),
    ]);
    return {
      availableCents: reaisToCents(balance.balance ?? 0),
      pendingCents: reaisToCents(statistics.value ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // Cobrança
  // -------------------------------------------------------------------------

  /**
   * Cliente do Asaas correspondente ao nosso `customerId`, criado sob demanda
   * DENTRO da subconta. O `externalReference` é a nossa identidade local, e é
   * por ele que reencontramos o cliente nas cobranças seguintes — e-mail muda,
   * id local não.
   */
  private async ensureCustomer(key: string, customerId: string): Promise<string> {
    const found = await this.request<{ data: { id: string; cpfCnpj?: string }[] }>(
      `/customers?externalReference=${encodeURIComponent(customerId)}&limit=1`,
      { key },
    );
    const existing = found.data[0];
    // Cliente completo: reusa. Cliente SEM documento é inútil — o Asaas recusa
    // emitir cobrança para ele —, então completa em vez de devolver um id que
    // vai falhar adiante. Acontece com registro criado antes de o produto
    // passar a coletar CPF.
    if (existing?.cpfCnpj) return existing.id;

    const payer = await this.resolvePayer(customerId);
    if (existing) {
      await this.postWithRetry(
        `/customers/${existing.id}`,
        { name: payer.name, cpfCnpj: payer.document.replace(/\D/g, '') },
        key,
      );
      return existing.id;
    }
    const created = await this.postWithRetry<{ id: string }>(
      '/customers',
      {
        name: payer.name,
        cpfCnpj: payer.document.replace(/\D/g, ''),
        ...(payer.email ? { email: payer.email } : {}),
        ...(payer.phone ? { mobilePhone: payer.phone.replace(/\D/g, '') } : {}),
        externalReference: customerId,
      },
      key,
    );
    return created.id;
  }

  async createCharge(input: NewCharge): Promise<Charge> {
    if (input.amountCents <= 0) {
      throw new PaymentProviderError('INVALID_AMOUNT', 'Valor da cobrança precisa ser positivo.');
    }
    if (input.method === 'CARD') {
      if (!input.cardToken) {
        throw new PaymentProviderError('CARD_DATA_REQUIRED', 'Cobrança no cartão exige token.');
      }
      if (!input.remoteIp) {
        throw new PaymentProviderError(
          'REMOTE_IP_REQUIRED',
          'Cobrança no cartão exige o IP do dispositivo do pagador.',
        );
      }
    }

    const key = await this.resolveAccountKey(input.accountId);
    const customer = await this.ensureCustomer(key, input.customerId);

    const created = await this.postWithRetry<Record<string, unknown>>(
      '/payments',
      {
        customer,
        billingType: input.method === 'PIX' ? 'PIX' : 'CREDIT_CARD',
        value: centsToReais(input.amountCents),
        dueDate: input.dueDate,
        ...(input.description ? { description: input.description } : {}),
        ...(input.externalReference ? { externalReference: input.externalReference } : {}),
        ...(input.cardToken ? { creditCardToken: input.cardToken } : {}),
        ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
        ...(input.split?.length
          ? {
              split: input.split.map((s) => ({
                walletId: s.walletId,
                ...(s.fixedValueCents !== undefined
                  ? { fixedValue: centsToReais(s.fixedValueCents) }
                  : {}),
                ...(s.percentageValue !== undefined
                  ? { percentualValue: s.percentageValue }
                  : {}),
              })),
            }
          : {}),
      },
      key,
    );

    return this.toCharge(created, input.accountId, input.customerId, key);
  }

  private async toCharge(
    raw: Record<string, unknown>,
    accountId: string,
    localCustomerId: string,
    key: string,
  ): Promise<Charge> {
    const id = String(raw.id);
    const method: 'PIX' | 'CARD' = raw.billingType === 'PIX' ? 'PIX' : 'CARD';

    // O split devolvido traz `totalValue`, que é o que o provedor VAI
    // repassar — calculado sobre o LÍQUIDO, não sobre o bruto. Guardar o que
    // pedimos em vez do que ele devolveu faria o extrato divergir em toda
    // cobrança, e a diferença muda conforme a taxa do meio de pagamento.
    const split: Split[] = ((raw.split as Record<string, unknown>[]) ?? []).map((s) => ({
      walletId: String(s.walletId),
      ...(s.totalValue != null ? { fixedValueCents: reaisToCents(Number(s.totalValue)) } : {}),
      ...(s.percentualValue != null ? { percentageValue: Number(s.percentualValue) } : {}),
    }));

    let pixCopyPaste: string | undefined;
    if (method === 'PIX') {
      try {
        const qr = await this.request<{ payload?: string }>(`/payments/${id}/pixQrCode`, { key });
        pixCopyPaste = qr.payload;
      } catch {
        // Conta sem chave Pix: a cobrança existe, o copia-e-cola não. Melhor
        // devolver a cobrança sem ele do que perder tudo.
      }
    }

    return {
      id,
      accountId,
      customerId: localCustomerId,
      method,
      status: STATUS_MAP[String(raw.status)] ?? 'PENDING',
      amountCents: reaisToCents(Number(raw.value ?? 0)),
      refundedCents: 0,
      split,
      dueDate: String(raw.dueDate),
      createdAt: String(raw.dateCreated ?? new Date().toISOString().slice(0, 10)),
      ...(raw.externalReference ? { externalReference: String(raw.externalReference) } : {}),
      ...(raw.confirmedDate ? { paidAt: String(raw.confirmedDate) } : {}),
      ...(pixCopyPaste ? { pixCopyPaste } : {}),
    };
  }

  async refund(chargeId: string, amountCents: number): Promise<Refund> {
    // O estorno roda na conta onde a cobrança nasceu; sem resolvedor, a chave
    // da plataforma não enxerga a cobrança da subconta e o Asaas devolve 404.
    const raw = await this.request<Record<string, unknown>>(`/payments/${chargeId}/refund`, {
      method: 'POST',
      body: { value: centsToReais(amountCents) },
    });
    return {
      id: String(raw.id ?? chargeId),
      chargeId,
      amountCents,
      status: 'DONE',
      refundedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Assinatura do clube (B2C)
  // -------------------------------------------------------------------------

  async createSubscription(input: NewSubscription): Promise<Subscription> {
    if (!input.remoteIp) {
      throw new PaymentProviderError(
        'REMOTE_IP_REQUIRED',
        'Assinatura exige o IP do dispositivo do pagador.',
      );
    }
    const key = await this.resolveAccountKey(input.accountId);
    const customer = await this.ensureCustomer(key, input.customerId);

    const raw = await this.postWithRetry<Record<string, unknown>>(
      '/subscriptions',
      {
        customer,
        billingType: 'CREDIT_CARD',
        value: centsToReais(input.amountCents),
        nextDueDate: input.nextDueDate,
        cycle: CYCLE_MAP[input.cycle],
        creditCardToken: input.cardToken,
        remoteIp: input.remoteIp,
        ...(input.description ? { description: input.description } : {}),
        ...(input.externalReference ? { externalReference: input.externalReference } : {}),
        ...(input.split?.length
          ? {
              split: input.split.map((s) => ({
                walletId: s.walletId,
                ...(s.percentageValue !== undefined
                  ? { percentualValue: s.percentageValue }
                  : {}),
              })),
            }
          : {}),
      },
      key,
    );

    return {
      id: String(raw.id),
      accountId: input.accountId,
      customerId: input.customerId,
      planId: input.planId,
      amountCents: reaisToCents(Number(raw.value ?? 0)),
      cycle: input.cycle,
      status: String(raw.status) === 'ACTIVE' ? 'ACTIVE' : 'PAST_DUE',
      nextDueDate: String(raw.nextDueDate),
      split: input.split ?? [],
      createdAt: String(raw.dateCreated ?? new Date().toISOString().slice(0, 10)),
      ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.request(`/subscriptions/${subscriptionId}`, { method: 'DELETE' });
  }

  async tokenizeCard(input: NewCardToken): Promise<{ token: string }> {
    if (!input.remoteIp) {
      throw new PaymentProviderError(
        'REMOTE_IP_REQUIRED',
        'Tokenização exige o IP do dispositivo do pagador — nunca o do servidor.',
      );
    }
    const key = await this.resolveAccountKey(input.accountId);
    const customer = await this.ensureCustomer(key, input.customerId);

    const raw = await this.postWithRetry<{ creditCardToken: string }>(
      '/creditCard/tokenize',
      {
        customer,
        creditCard: {
          holderName: input.holderName,
          number: input.number,
          expiryMonth: input.expiryMonth,
          expiryYear: input.expiryYear,
          ccv: input.ccv,
        },
        remoteIp: input.remoteIp,
      },
      key,
    );
    return { token: raw.creditCardToken };
  }
}

let cached: AsaasPaymentProvider | null = null;

export function getAsaasPaymentProvider(): AsaasPaymentProvider {
  cached ??= new AsaasPaymentProvider();
  return cached;
}

/** Só para teste: descarta o cliente memoizado. */
export function resetAsaasPaymentProvider(): void {
  cached = null;
}
