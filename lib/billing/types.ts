import type { BillingPlanCode } from './plans';

/**
 * Port do provedor de assinatura B2B da plataforma (Stripe Billing na F8.1).
 *
 * Diferença essencial em relação a `PaymentProvider` (B2C/Asaas): o Stripe
 * cobra SOMENTE a mensalidade do software, na conta única da plataforma. O dono
 * do salão NÃO tem conta no Stripe, então aqui não existe subconta, carteira,
 * KYC nem split — todo o dinheiro B2C (serviços e clube) é do Asaas, em outra
 * fase. Quem tentar procurar `split` neste módulo está no port errado.
 *
 * Mesmo contrato dos demais ports (`contexto-comum.md` §5): interface aqui,
 * `MockBillingProvider` que reprova o que o Stripe reprovaria, factory por
 * `BILLING_PROVIDER`, e suíte de contrato parametrizada que a F8.1 reusa contra
 * o test mode. Nenhum código de produto importa o SDK do Stripe diretamente.
 */

export type BillingSubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface NewBillingCustomer {
  /** Id do tenant — vira `externalReference`, nunca o e-mail, como chave. */
  tenantId: string;
  name: string;
  email?: string;
  /** CPF/CNPJ do estabelecimento, apenas dígitos. */
  document?: string;
}

export interface BillingCustomer {
  id: string;
  tenantId: string;
  name: string;
  email?: string;
  createdAt: string;
}

/**
 * Cartão do dono do salão, tokenizado antes de sair do cliente. O port nunca vê
 * o PAN em claro fora da tokenização. Sem `remoteIp`: exigir IP do pagador é
 * regra do Asaas (B2C), não do Stripe.
 */
export interface NewBillingCard {
  customerId: string;
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface NewBillingSubscription {
  customerId: string;
  plan: BillingPlanCode;
  /** Obtido via `tokenizeCard`. */
  cardToken: string;
  externalReference?: string;
  /**
   * Quando definido, a assinatura nasce `TRIALING` até esta data (ISO 8601). O
   * trial do produto é por valor (10 agendamentos, F7.1); este campo é o trial
   * de cobrança do provedor, ortogonal a ele.
   */
  trialEndsAt?: string;
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  plan: BillingPlanCode;
  /** Mensalidade do plano, resolvida da configuração — nunca do chamador. */
  amountCents: number;
  currency: 'BRL';
  status: BillingSubscriptionStatus;
  currentPeriodEnd: string;
  /** Cancelamento agendado para o fim do período, em vez de imediato. */
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: string;
  externalReference?: string;
  createdAt: string;
  canceledAt?: string;
}

export interface BillingProvider {
  createCustomer(input: NewBillingCustomer): Promise<BillingCustomer>;
  getCustomer(customerId: string): Promise<BillingCustomer>;
  tokenizeCard(input: NewBillingCard): Promise<{ token: string }>;
  createSubscription(input: NewBillingSubscription): Promise<BillingSubscription>;
  getSubscription(subscriptionId: string): Promise<BillingSubscription>;
  /** Troca de plano com proração (o provedor calcula o ajuste). */
  changePlan(subscriptionId: string, nextPlan: BillingPlanCode): Promise<BillingSubscription>;
  updatePaymentMethod(
    subscriptionId: string,
    cardToken: string,
  ): Promise<BillingSubscription>;
  cancelSubscription(
    subscriptionId: string,
    atPeriodEnd?: boolean,
  ): Promise<BillingSubscription>;
}

export type BillingErrorCode =
  | 'VALIDATION'
  | 'CUSTOMER_NOT_FOUND'
  | 'INVALID_CARD'
  | 'CARD_TOKEN_INVALID'
  | 'UNKNOWN_PLAN'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'SUBSCRIPTION_ALREADY_EXISTS'
  | 'SUBSCRIPTION_NOT_ACTIVE'
  | 'INVALID_PLAN_CHANGE';

/**
 * Erro de domínio dos providers de billing. O adaptador real traduz as falhas
 * do Stripe para estes códigos; nenhum código de produto depende de mensagem ou
 * de formato de erro do fornecedor.
 */
export class BillingProviderError extends Error {
  constructor(
    readonly code: BillingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BillingProviderError';
  }
}
