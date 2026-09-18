/**
 * Port do provedor de pagamentos B2C (Asaas na F8.2).
 *
 * Assinaturas mínimas definidas em `fases/fase-0-fundacao.md` item 6. Toda a
 * regra de negócio é escrita contra elas; a troca mock → Asaas é uma variável de
 * ambiente, nunca uma alteração no código de produto.
 *
 * Dinheiro é sempre `number` inteiro em centavos (`fases/contexto-comum.md` §3.1).
 */
export type KycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface NewMerchant {
  name: string;
  /** CPF/CNPJ, apenas dígitos. */
  document: string;
  email?: string;
  phone?: string;
  /** Chave Pix de repasse do estabelecimento (spec-executiva.md §3.2). */
  pixKey?: string;
}

export interface MerchantAccount {
  accountId: string;
  walletId: string;
  name: string;
  document: string;
  kycStatus: KycStatus;
  createdAt: string;
}

export type PaymentMethod = 'PIX' | 'CARD';

export type ChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'REFUSED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/**
 * Split do valor para outra carteira. O provedor real recusa split apontando
 * para a carteira de quem cria a cobrança (`plano-refatoracao.md` §1.1); a
 * cobrança do salão nasce na subconta dele e a taxa vai para a plataforma.
 *
 * Exatamente um entre `fixedValueCents` e `percentageValue` deve ser informado.
 */
export interface Split {
  walletId: string;
  fixedValueCents?: number;
  percentageValue?: number;
}

export interface NewCharge {
  /** Subconta que cria a cobrança. É o recebedor do serviço (spec §3.2). */
  accountId: string;
  /** Identidade local do pagador; o adaptador mapeia/cria o customer no provider. */
  customerId: string;
  method: PaymentMethod;
  amountCents: number;
  /** Vencimento no formato `YYYY-MM-DD`. */
  dueDate: string;
  description?: string;
  /** Id local do que originou a cobrança (ex.: `paymentId` cuid). */
  externalReference?: string;
  split?: readonly Split[];
  /** Obrigatório quando `method === 'CARD'`; obtido via `tokenizeCard`. */
  cardToken?: string;
  /**
   * IP do dispositivo do pagador — nunca o IP do servidor. Obrigatório em
   * cartão; o mock recusa ausente, privado ou de loopback.
   */
  remoteIp?: string;
}

export interface Charge {
  id: string;
  accountId: string;
  customerId: string;
  method: PaymentMethod;
  status: ChargeStatus;
  amountCents: number;
  refundedCents: number;
  split: readonly Split[];
  externalReference?: string;
  dueDate: string;
  createdAt: string;
  paidAt?: string;
  expiresAt?: string;
  /** Payload copia-e-cola do Pix, quando `method === 'PIX'`. */
  pixCopyPaste?: string;
  cardLast4?: string;
}

export interface Refund {
  id: string;
  chargeId: string;
  amountCents: number;
  status: 'DONE';
  refundedAt: string;
}

export type SubscriptionCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface NewSubscription {
  accountId: string;
  customerId: string;
  /** Id local do `MembershipPlan` (F5). */
  planId: string;
  amountCents: number;
  cycle: SubscriptionCycle;
  /** Primeira cobrança no formato `YYYY-MM-DD`. */
  nextDueDate: string;
  description?: string;
  cardToken: string;
  /** Mesmo rigor da cobrança avulsa: recorrente com cartão exige IP do pagador. */
  remoteIp: string;
  split?: readonly Split[];
  externalReference?: string;
}

export interface Subscription {
  id: string;
  accountId: string;
  customerId: string;
  planId: string;
  amountCents: number;
  cycle: SubscriptionCycle;
  status: SubscriptionStatus;
  nextDueDate: string;
  split: readonly Split[];
  externalReference?: string;
  createdAt: string;
  canceledAt?: string;
}

export interface NewCardToken {
  accountId: string;
  /** O token pertence ao cliente que o originou e não pode ser reusado por outro (F5). */
  customerId: string;
  number: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
  remoteIp: string;
}

export interface PaymentProvider {
  createMerchantAccount(
    input: NewMerchant,
  ): Promise<{ accountId: string; walletId: string; kycStatus: KycStatus }>;
  getMerchantAccount(accountId: string): Promise<MerchantAccount>;
  getBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>;
  createCharge(input: NewCharge): Promise<Charge>;
  refund(chargeId: string, amountCents: number): Promise<Refund>;
  createSubscription(input: NewSubscription): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  tokenizeCard(input: NewCardToken): Promise<{ token: string }>;
}

export type PaymentErrorCode =
  | 'VALIDATION'
  | 'ACCOUNT_NOT_FOUND'
  | 'KYC_NOT_APPROVED'
  | 'INVALID_AMOUNT'
  | 'INVALID_SPLIT'
  | 'SPLIT_TO_SELF'
  | 'REMOTE_IP_REQUIRED'
  | 'REMOTE_IP_NOT_PUBLIC'
  | 'CARD_DATA_REQUIRED'
  | 'CARD_TOKEN_INVALID'
  | 'INVALID_CARD'
  | 'CHARGE_NOT_FOUND'
  | 'INVALID_CHARGE_STATE'
  | 'REFUND_EXCEEDS_AMOUNT'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'SUBSCRIPTION_NOT_ACTIVE';

/**
 * Erro de domínio dos providers de pagamento. Os adaptadores reais traduzem as
 * falhas do provedor para estes códigos; nenhum código de produto depende de
 * mensagem ou de formato de erro do fornecedor.
 */
export class PaymentProviderError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}
