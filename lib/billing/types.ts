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
 *
 * O CARTÃO NUNCA CHEGA AO NOSSO SERVIDOR. O port nasceu com `tokenizeCard`
 * recebendo PAN e CCV, espelhando o Asaas — que aceita isso porque exige o IP
 * do pagador e assume a captura. O Stripe só libera as "raw card data APIs"
 * mediante certificação PCI DSS nossa; a integração recomendada tokeniza no
 * cliente. Então a captura do cartão saiu do port e virou REDIRECIONAMENTO:
 * `createCheckoutSession` devolve uma URL hospedada onde o dono paga, e o
 * webhook conta o que aconteceu. `createPortalSession` faz o mesmo para
 * trocar cartão e ver faturas.
 *
 * O QUE **NÃO** FOI PARA O PORTAL HOSPEDADO: troca de plano e cancelamento.
 * Os dois continuam métodos daqui, chamados do nosso servidor, porque o
 * downgrade tem regra nossa (`lib/billing/limits.ts`: não dá para cair para o
 * Solo com três profissionais ativos sem decidir quem desativar). Se o dono
 * trocasse de plano dentro do portal do Stripe, essa regra seria contornada
 * pelas costas do produto. Nenhum dos dois toca em cartão, então nenhum dos
 * dois traz PCI junto.
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

export interface NewCheckoutSession {
  customerId: string;
  plan: BillingPlanCode;
  /** Para onde o provedor manda o dono de volta ao concluir. */
  successUrl: string;
  /** Para onde manda se ele desistir. */
  cancelUrl: string;
  externalReference?: string;
  /**
   * Quando definido, a assinatura nasce `TRIALING` até esta data (ISO 8601). O
   * trial do produto é por valor (10 agendamentos, F7.1); este campo é o trial
   * de cobrança do provedor, ortogonal a ele.
   */
  trialEndsAt?: string;
}

/**
 * Sessão hospedada. `url` é para onde redirecionar; o produto não guarda nada
 * dela além do id, que serve para reconciliar o webhook com quem iniciou.
 */
export interface HostedSession {
  id: string;
  url: string;
  /** Expiração da URL, ISO 8601. Sessão vencida exige criar outra. */
  expiresAt: string;
}

export interface NewPortalSession {
  customerId: string;
  /** Para onde o dono volta ao fechar o portal. */
  returnUrl: string;
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
  /**
   * Abre a página hospedada onde o dono assina. A assinatura NÃO existe quando
   * esta chamada retorna: ela nasce no provedor quando o pagamento conclui, e
   * chega até nós por webhook (`SUBSCRIPTION_CREATED`). Quem chamar isto e
   * esperar um `BillingSubscription` de volta entendeu o fluxo ao contrário.
   */
  createCheckoutSession(input: NewCheckoutSession): Promise<HostedSession>;
  /** Portal hospedado: trocar cartão, ver faturas, baixar recibo. */
  createPortalSession(input: NewPortalSession): Promise<HostedSession>;
  getSubscription(subscriptionId: string): Promise<BillingSubscription>;
  /** Troca de plano com proração (o provedor calcula o ajuste). */
  changePlan(subscriptionId: string, nextPlan: BillingPlanCode): Promise<BillingSubscription>;
  cancelSubscription(
    subscriptionId: string,
    atPeriodEnd?: boolean,
  ): Promise<BillingSubscription>;
}

export type BillingErrorCode =
  | 'VALIDATION'
  | 'CUSTOMER_NOT_FOUND'
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
