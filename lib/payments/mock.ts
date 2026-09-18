import { randomUUID } from 'node:crypto';
import {
  appendWebhookDelivery,
  copy,
  getMockPaymentStore,
  nextMockId,
  type MockPaymentStore,
  type WebhookDeliveryLogEntry,
} from './mock-store';
import { isPublicIp, resolvePayerIp } from './remote-ip';
import {
  buildMockWebhookRequest,
  fetchWebhookTransport,
  getPaymentsWebhookSecret,
  resolvePaymentsWebhookUrl,
  type PaymentWebhookChargeData,
  type PaymentWebhookEvent,
  type PaymentWebhookEventType,
  type WebhookTransport,
} from './webhook';
import {
  PaymentProviderError,
  type Charge,
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

export interface MockSimulationResult {
  eventId: string;
  delivered: boolean;
  httpStatus?: number;
  error?: string;
}

export interface MockPaymentProviderOptions {
  /** Store isolado (testes); o padrão é o store global compartilhado com /dev. */
  store?: MockPaymentStore;
  transport?: WebhookTransport;
  /** Sobrescreve `PAYMENTS_WEBHOOK_URL`/`resolvePaymentsWebhookUrl()`. */
  webhookUrl?: string;
  /** Sobrescreve `PAYMENTS_WEBHOOK_SECRET`. */
  webhookSecret?: string;
  now?: () => Date;
}

/**
 * Mock do provedor de pagamentos (Asaas na F8.2), usado de F4 a F7.
 *
 * Não é um stub permissivo: recusa split para a própria carteira, cobrança em
 * subconta com KYC pendente, cartão sem `remoteIp` do pagador, valores
 * fracionados — as mesmas regras que o Asaas reprova. E não marca pagamento de
 * forma síncrona: a confirmação chega por webhook HTTP na rota real da
 * aplicação (`fases/contexto-comum.md` §5.1 e §5.2).
 */
export class MockPaymentProvider implements PaymentProvider {
  private readonly store: MockPaymentStore;
  private readonly transport: WebhookTransport;
  private readonly webhookUrlOption: string | undefined;
  private readonly webhookSecretOption: string | undefined;
  private readonly now: () => Date;

  constructor(options: MockPaymentProviderOptions = {}) {
    this.store = options.store ?? getMockPaymentStore();
    this.transport = options.transport ?? fetchWebhookTransport;
    this.webhookUrlOption = options.webhookUrl;
    this.webhookSecretOption = options.webhookSecret;
    this.now = options.now ?? (() => new Date());
  }

  async createMerchantAccount(
    input: NewMerchant,
  ): Promise<{ accountId: string; walletId: string; kycStatus: KycStatus }> {
    if (input.name.trim().length < 2) {
      throw new PaymentProviderError('VALIDATION', 'Nome do estabelecimento é obrigatório.');
    }
    const document = digitsOnly(input.document);
    if (document.length !== 11 && document.length !== 14) {
      throw new PaymentProviderError(
        'VALIDATION',
        'Documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos).',
      );
    }

    const accountId = nextMockId(this.store, 'acc_mock');
    const walletId = nextMockId(this.store, 'wallet_mock');
    const createdAt = this.now().toISOString();
    const merchant: MerchantAccount = {
      accountId,
      walletId,
      name: input.name.trim(),
      document,
      kycStatus: 'PENDING',
      createdAt,
    };
    this.store.merchants.set(accountId, merchant);
    this.store.appMerchants.set(accountId, {
      accountId,
      kycStatus: 'PENDING',
      updatedAt: createdAt,
    });

    return { accountId, walletId, kycStatus: 'PENDING' };
  }

  async getMerchantAccount(accountId: string): Promise<MerchantAccount> {
    return copy(this.requireMerchant(accountId));
  }

  async getBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }> {
    this.requireMerchant(accountId);
    let availableCents = 0;
    let pendingCents = 0;
    for (const charge of this.store.charges.values()) {
      if (charge.accountId !== accountId) {
        continue;
      }
      if (charge.status === 'PENDING') {
        pendingCents += charge.amountCents;
        continue;
      }
      if (
        charge.status === 'PAID' ||
        charge.status === 'PARTIALLY_REFUNDED' ||
        charge.status === 'REFUNDED'
      ) {
        availableCents += Math.max(charge.amountCents - charge.refundedCents, 0);
      }
    }
    return { availableCents, pendingCents };
  }

  async createCharge(input: NewCharge): Promise<Charge> {
    const merchant = this.requireMerchant(input.accountId);
    this.requireApprovedKyc(merchant);
    const amountCents = requirePositiveInteger(input.amountCents, 'amountCents');
    const split = validateSplit(input.split, merchant.walletId, amountCents);
    requireDate(input.dueDate, 'dueDate');
    if (input.method !== 'PIX' && input.method !== 'CARD') {
      throw new PaymentProviderError('VALIDATION', `Método inválido: ${String(input.method)}`);
    }

    let cardLast4: string | undefined;
    if (input.method === 'CARD') {
      requirePublicRemoteIp(input.remoteIp);
      if (!input.cardToken) {
        throw new PaymentProviderError(
          'CARD_DATA_REQUIRED',
          'Cobrança de cartão exige cardToken.',
        );
      }
      const tokenRecord = this.store.cardTokens.get(input.cardToken);
      if (
        !tokenRecord ||
        tokenRecord.accountId !== input.accountId ||
        tokenRecord.customerId !== input.customerId
      ) {
        throw new PaymentProviderError(
          'CARD_TOKEN_INVALID',
          'Token de cartão não pertence ao cliente/conta informados.',
        );
      }
      cardLast4 = tokenRecord.last4;
    }

    const id = nextMockId(this.store, 'chg_mock');
    const createdAt = this.now().toISOString();
    const charge: Charge = {
      id,
      accountId: input.accountId,
      customerId: input.customerId,
      method: input.method,
      // Pagamento nunca nasce pago: quem marca é o webhook.
      status: 'PENDING',
      amountCents,
      refundedCents: 0,
      split: copy(split),
      dueDate: input.dueDate,
      createdAt,
      ...(input.externalReference ? { externalReference: input.externalReference } : {}),
      ...(input.method === 'PIX'
        ? {
            expiresAt: `${input.dueDate}T23:59:59.000Z`,
            pixCopyPaste: buildMockPixPayload(id, amountCents),
          }
        : {}),
      ...(cardLast4 ? { cardLast4 } : {}),
    };
    this.store.charges.set(id, charge);
    this.store.appCharges.set(id, {
      chargeId: id,
      status: 'PENDING',
      refundedCents: 0,
      lastEventType: 'CHARGE_CREATED',
      updatedAt: createdAt,
    });

    return copy(charge);
  }

  async refund(chargeId: string, amountCents: number): Promise<Refund> {
    const charge = this.requireCharge(chargeId);
    const amount = requirePositiveInteger(amountCents, 'amountCents');
    if (charge.status !== 'PAID' && charge.status !== 'PARTIALLY_REFUNDED') {
      throw new PaymentProviderError(
        'INVALID_CHARGE_STATE',
        `Estorno exige cobrança paga; status atual: ${charge.status}.`,
      );
    }
    const remaining = charge.amountCents - charge.refundedCents;
    if (amount > remaining) {
      throw new PaymentProviderError(
        'REFUND_EXCEEDS_AMOUNT',
        `Estorno de ${amount} excede o saldo estornável de ${remaining}.`,
      );
    }

    const refund: Refund = {
      id: nextMockId(this.store, 'ref_mock'),
      chargeId,
      amountCents: amount,
      status: 'DONE',
      refundedAt: this.now().toISOString(),
    };
    this.store.refunds.set(refund.id, refund);
    charge.refundedCents += amount;
    charge.status = charge.refundedCents >= charge.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    await this.deliverEvent(
      charge.status === 'REFUNDED' ? 'CHARGE_REFUNDED' : 'CHARGE_PARTIALLY_REFUNDED',
      { charge: chargeWebhookData(charge) },
    );

    return copy(refund);
  }

  async createSubscription(input: NewSubscription): Promise<Subscription> {
    const merchant = this.requireMerchant(input.accountId);
    this.requireApprovedKyc(merchant);
    const amountCents = requirePositiveInteger(input.amountCents, 'amountCents');
    requireDate(input.nextDueDate, 'nextDueDate');
    requireSubscriptionCycle(input.cycle);
    const split = validateSplit(input.split, merchant.walletId, amountCents);
    requirePublicRemoteIp(input.remoteIp);
    this.requireCardToken(input.cardToken, input.accountId, input.customerId);
    if (!input.planId) {
      throw new PaymentProviderError('VALIDATION', 'planId é obrigatório.');
    }

    const subscription: Subscription = {
      id: nextMockId(this.store, 'sub_mock'),
      accountId: input.accountId,
      customerId: input.customerId,
      planId: input.planId,
      amountCents,
      cycle: input.cycle,
      status: 'ACTIVE',
      nextDueDate: input.nextDueDate,
      split: copy(split),
      createdAt: this.now().toISOString(),
      ...(input.externalReference ? { externalReference: input.externalReference } : {}),
    };
    this.store.subscriptions.set(subscription.id, subscription);

    // O ciclo de vida (renovação, falha de cobrança) chega por webhook na F5.1;
    // aqui a assinatura nasce ativa, como no Asaas.
    return copy(subscription);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const subscription = this.store.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new PaymentProviderError(
        'SUBSCRIPTION_NOT_FOUND',
        `Assinatura não encontrada: ${subscriptionId}`,
      );
    }
    if (subscription.status === 'CANCELED') {
      throw new PaymentProviderError(
        'SUBSCRIPTION_NOT_ACTIVE',
        'Assinatura já está cancelada.',
      );
    }
    subscription.status = 'CANCELED';
    subscription.canceledAt = this.now().toISOString();
  }

  async tokenizeCard(input: NewCardToken): Promise<{ token: string }> {
    this.requireMerchant(input.accountId);
    requirePublicRemoteIp(input.remoteIp);
    if (!input.customerId) {
      throw new PaymentProviderError('VALIDATION', 'customerId é obrigatório.');
    }
    if (input.holderName.trim().length < 2) {
      throw new PaymentProviderError('VALIDATION', 'Nome do portador é obrigatório.');
    }

    const number = digitsOnly(input.number);
    if (number.length < 13 || number.length > 19 || !luhnValid(number)) {
      throw new PaymentProviderError('INVALID_CARD', 'Número de cartão inválido.');
    }
    const month = Number(input.expiryMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new PaymentProviderError('INVALID_CARD', 'Mês de validade inválido.');
    }
    if (!/^\d{4}$/.test(input.expiryYear)) {
      throw new PaymentProviderError('INVALID_CARD', 'Ano de validade inválido.');
    }
    if (!/^\d{3,4}$/.test(input.ccv)) {
      throw new PaymentProviderError('INVALID_CARD', 'CCV inválido.');
    }

    const token = `tok_mock_${randomUUID()}`;
    // Nunca guardamos o PAN, só o suficiente para o console /dev identificar o cartão.
    this.store.cardTokens.set(token, {
      token,
      accountId: input.accountId,
      customerId: input.customerId,
      last4: number.slice(-4),
      createdAt: this.now().toISOString(),
    });
    return { token };
  }

  /**
   * Controles do console /dev — simulam uma decisão do provedor e disparam o
   * webhook correspondente. O estado do lado da aplicação só muda quando o
   * webhook chega.
   */
  async simulateChargePaid(chargeId: string): Promise<MockSimulationResult> {
    const charge = this.requireCharge(chargeId);
    this.requireChargeStatus(charge, ['PENDING']);
    charge.status = 'PAID';
    charge.paidAt = this.now().toISOString();
    return this.deliverEvent('CHARGE_PAID', { charge: chargeWebhookData(charge) });
  }

  async simulateChargeRefused(chargeId: string): Promise<MockSimulationResult> {
    const charge = this.requireCharge(chargeId);
    this.requireChargeStatus(charge, ['PENDING']);
    charge.status = 'REFUSED';
    return this.deliverEvent('CHARGE_REFUSED', { charge: chargeWebhookData(charge) });
  }

  async simulatePixExpired(chargeId: string): Promise<MockSimulationResult> {
    const charge = this.requireCharge(chargeId);
    if (charge.method !== 'PIX') {
      throw new PaymentProviderError(
        'INVALID_CHARGE_STATE',
        'Só cobrança Pix pode expirar.',
      );
    }
    this.requireChargeStatus(charge, ['PENDING']);
    charge.status = 'EXPIRED';
    return this.deliverEvent('CHARGE_EXPIRED', { charge: chargeWebhookData(charge) });
  }

  async simulateKycDecision(
    accountId: string,
    kycStatus: Extract<KycStatus, 'APPROVED' | 'REJECTED'>,
  ): Promise<MockSimulationResult> {
    const merchant = this.requireMerchant(accountId);
    merchant.kycStatus = kycStatus;
    return this.deliverEvent('MERCHANT_KYC_UPDATED', {
      merchant: {
        accountId: merchant.accountId,
        walletId: merchant.walletId,
        kycStatus,
      },
    });
  }

  private async deliverEvent(
    type: PaymentWebhookEventType,
    data: PaymentWebhookEvent['data'],
  ): Promise<MockSimulationResult> {
    const event: PaymentWebhookEvent = {
      provider: 'mock',
      eventId: `evt_mock_${randomUUID()}`,
      type,
      occurredAt: this.now().toISOString(),
      data,
    };

    let delivered = false;
    let httpStatus: number | undefined;
    let error: string | undefined;
    let url = this.webhookUrlOption ?? '';

    try {
      url = this.webhookUrlOption ?? (await resolvePaymentsWebhookUrl());
      const secret = this.webhookSecretOption ?? getPaymentsWebhookSecret();
      const request = buildMockWebhookRequest(event, { url, secret });
      const response = await this.transport.deliver(request);
      delivered = response.ok;
      httpStatus = response.status;
      if (!response.ok) {
        error = `webhook respondeu ${response.status}`;
      }
    } catch (cause) {
      error = errorMessage(cause);
    }

    const logEntry: WebhookDeliveryLogEntry = {
      id: randomUUID(),
      eventId: event.eventId,
      type,
      url,
      delivered,
      at: event.occurredAt,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(error ? { error } : {}),
    };
    appendWebhookDelivery(this.store, logEntry);

    return {
      eventId: event.eventId,
      delivered,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(error ? { error } : {}),
    };
  }

  private requireMerchant(accountId: string): MerchantAccount {
    const merchant = this.store.merchants.get(accountId);
    if (!merchant) {
      throw new PaymentProviderError(
        'ACCOUNT_NOT_FOUND',
        `Conta não encontrada: ${accountId}`,
      );
    }
    return merchant;
  }

  private requireApprovedKyc(merchant: MerchantAccount): void {
    if (merchant.kycStatus !== 'APPROVED') {
      throw new PaymentProviderError(
        'KYC_NOT_APPROVED',
        `Conta ${merchant.accountId} com KYC ${merchant.kycStatus}: cobrança recusada.`,
      );
    }
  }

  private requireCharge(chargeId: string): Charge {
    const charge = this.store.charges.get(chargeId);
    if (!charge) {
      throw new PaymentProviderError(
        'CHARGE_NOT_FOUND',
        `Cobrança não encontrada: ${chargeId}`,
      );
    }
    return charge;
  }

  private requireChargeStatus(charge: Charge, allowed: readonly Charge['status'][]): void {
    if (!allowed.includes(charge.status)) {
      throw new PaymentProviderError(
        'INVALID_CHARGE_STATE',
        `Cobrança ${charge.id} está ${charge.status}; esperado: ${allowed.join(', ')}.`,
      );
    }
  }

  private requireCardToken(token: string, accountId: string, customerId: string): void {
    const record = this.store.cardTokens.get(token);
    if (!record || record.accountId !== accountId || record.customerId !== customerId) {
      throw new PaymentProviderError(
        'CARD_TOKEN_INVALID',
        'Token de cartão não pertence ao cliente/conta informados.',
      );
    }
  }
}

function chargeWebhookData(charge: Charge): PaymentWebhookChargeData {
  return {
    id: charge.id,
    accountId: charge.accountId,
    status: charge.status,
    amountCents: charge.amountCents,
    refundedCents: charge.refundedCents,
    ...(charge.paidAt ? { paidAt: charge.paidAt } : {}),
  };
}

function requirePositiveInteger(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new PaymentProviderError(
      'INVALID_AMOUNT',
      `${field} deve ser inteiro em centavos e maior que zero (recebido: ${String(value)}).`,
    );
  }
  return value;
}

function requirePublicRemoteIp(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new PaymentProviderError(
      'REMOTE_IP_REQUIRED',
      'Cobrança de cartão exige o remoteIp do dispositivo do pagador.',
    );
  }
  // Em dev, loopback é substituído por DEV_PAYER_IP (se configurado). Em
  // produção a variável não existe e a regra é a mesma do Asaas.
  const resolved = resolvePayerIp(value);
  if (!resolved || !isPublicIp(resolved)) {
    throw new PaymentProviderError(
      'REMOTE_IP_NOT_PUBLIC',
      `remoteIp não é um IP público de pagador: ${JSON.stringify(value)}.`,
    );
  }
  return resolved;
}

function validateSplit(
  split: readonly Split[] | undefined,
  creatorWalletId: string,
  amountCents: number,
): readonly Split[] {
  if (!split || split.length === 0) {
    return [];
  }

  let totalCents = 0;
  const normalized: Split[] = [];
  for (const entry of split) {
    if (!entry.walletId) {
      throw new PaymentProviderError('INVALID_SPLIT', 'Split exige walletId.');
    }
    if (entry.walletId === creatorWalletId) {
      throw new PaymentProviderError(
        'SPLIT_TO_SELF',
        'Split não pode apontar para a carteira de quem cria a cobrança.',
      );
    }
    const hasFixed = entry.fixedValueCents !== undefined;
    const hasPercentage = entry.percentageValue !== undefined;
    if (hasFixed === hasPercentage) {
      throw new PaymentProviderError(
        'INVALID_SPLIT',
        'Split exige exatamente um entre fixedValueCents e percentageValue.',
      );
    }

    if (hasFixed) {
      const fixed = requirePositiveInteger(entry.fixedValueCents as number, 'fixedValueCents');
      totalCents += fixed;
      normalized.push({ walletId: entry.walletId, fixedValueCents: fixed });
    } else {
      const percentage = entry.percentageValue as number;
      if (
        typeof percentage !== 'number' ||
        !Number.isFinite(percentage) ||
        percentage <= 0 ||
        percentage > 100
      ) {
        throw new PaymentProviderError(
          'INVALID_SPLIT',
          `percentageValue inválido: ${String(percentage)}.`,
        );
      }
      totalCents += Math.round((amountCents * percentage) / 100);
      normalized.push({ walletId: entry.walletId, percentageValue: percentage });
    }
  }

  if (totalCents > amountCents) {
    throw new PaymentProviderError(
      'INVALID_SPLIT',
      `Split de ${totalCents} excede o valor da cobrança (${amountCents}).`,
    );
  }
  return normalized;
}

function requireDate(value: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PaymentProviderError('VALIDATION', `${field} deve estar no formato YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new PaymentProviderError('VALIDATION', `${field} não é uma data válida.`);
  }
}

function requireSubscriptionCycle(value: SubscriptionCycle): void {
  const cycles: readonly SubscriptionCycle[] = ['MONTHLY', 'QUARTERLY', 'YEARLY'];
  if (!cycles.includes(value)) {
    throw new PaymentProviderError('VALIDATION', `Ciclo inválido: ${String(value)}`);
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const char = digits[index];
    if (char === undefined) {
      return false;
    }
    let digit = Number(char);
    if (double) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Conteúdo fake: serve só para o console /dev exibir algo no lugar do QR. */
function buildMockPixPayload(chargeId: string, amountCents: number): string {
  return `PIX-MOCK:${chargeId}:${amountCents}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

let singleton: MockPaymentProvider | undefined;

/** Instância compartilhada pelo código de produto e pelo console /dev. */
export function getMockPaymentProvider(): MockPaymentProvider {
  singleton ??= new MockPaymentProvider();
  return singleton;
}

export function resetMockPaymentProvider(): void {
  singleton = undefined;
}
