import type { BookingStatus, PaymentMode } from '@prisma/client';
import { confirmBooking, ConfirmBookingError } from '@/lib/booking/confirm';
import type { TenantContext } from '@/lib/tenant/context';
import { getPaymentProvider } from './index';
import { PaymentProviderError, type Charge, type PaymentMethod, type Split } from './types';

/**
 * Núcleo do checkout B2C (tarefa F4.2, fase 4 itens 2 e 3).
 *
 * Este módulo é quem transforma um HOLD da F3.3 em uma cobrança de verdade —
 * contra o `PaymentProvider` (mock até a F8) — e grava o `Payment` local que o
 * webhook da F4.0 usa como registro de referência.
 *
 * A REGRA QUE SUSTENTA O NEGÓCIO. A cobrança nasce na SUBCONTA do
 * estabelecimento (`AsaasAccount.asaasAccountId`) e o split leva apenas a taxa
 * para a carteira da plataforma (`PLATFORM_WALLET_ID`). O contrário — cobrar na
 * conta principal e repassar por transferência — transformaria o faturamento
 * dos salões em receita da empresa de software perante a Receita Federal
 * (spec §3.2, plano §1.1 e §8.3). Por isso o accountId NUNCA vem do chamador:
 * é lido da conta do tenant. Há teste que falha se essa direção inverter.
 *
 * DINHEIRO INTEIRO EM CENTAVOS. A taxa é configurada em pontos-base
 * (`PLATFORM_FEE_BASIS_POINTS`, 1000 = 10%) e vira centavos com `Math.round`
 * ANTES de virar split. O split é enviado como `fixedValueCents`, não como
 * percentual: assim o provedor não recalcula e não existe o centavo de
 * diferença que o plano manda evitar.
 *
 * FORA DA TRANSAÇÃO. `createCharge`/`tokenizeCard` são chamadas externas e NÃO
 * podem viver dentro de uma callback de `forTenant` — a callback é reexecutada
 * sob disputa (P2034) e uma chamada externa duplicaria. Aqui o provedor é
 * chamado primeiro, fora; a persistência vem depois e é a única parte
 * transacional.
 *
 * KYC NÃO APROVADO NÃO TRAVA O SALÃO. Quando a subconta não está utilizável
 * (KYC pendente/recusado ou conta ainda inexistente no provedor), o checkout
 * cai para `ON_SITE`: o agendamento confirma e o pagamento acontece no balcão.
 * O salão nunca fica sem conseguir usar o sistema (plano §8.2).
 */

// ---------------------------------------------------------------------------
// Configuração da plataforma
// ---------------------------------------------------------------------------

export class CheckoutConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutConfigError';
  }
}

/**
 * Taxa da plataforma em pontos-base (1000 = 10%). Configuração da plataforma,
 * nunca número mágico no meio do código.
 */
export function getPlatformFeeBasisPoints(): number {
  const raw = process.env.PLATFORM_FEE_BASIS_POINTS?.trim();
  if (!raw) {
    throw new CheckoutConfigError(
      'PLATFORM_FEE_BASIS_POINTS não configurado: a taxa do split não pode ser um número fixo no código.',
    );
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value >= 10_000) {
    throw new CheckoutConfigError(
      `PLATFORM_FEE_BASIS_POINTS inválido: ${JSON.stringify(raw)}. Use inteiro entre 1 e 9999 (1000 = 10%).`,
    );
  }
  return value;
}

/** Carteira que recebe a taxa. Diferente, por construção, da carteira da subconta. */
export function getPlatformWalletId(): string {
  const walletId = process.env.PLATFORM_WALLET_ID?.trim();
  if (!walletId) {
    throw new CheckoutConfigError(
      'PLATFORM_WALLET_ID não configurado: não há como montar o split para a plataforma.',
    );
  }
  return walletId;
}

/** Taxa em centavos, arredondada UMA vez, a partir dos pontos-base. */
export function computePlatformFeeCents(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new CheckoutConfigError(`amountCents inválido para a taxa: ${String(amountCents)}.`);
  }
  return Math.round((amountCents * getPlatformFeeBasisPoints()) / 10_000);
}

function buildPlatformSplit(amountCents: number): Split[] {
  return [{ walletId: getPlatformWalletId(), fixedValueCents: computePlatformFeeCents(amountCents) }];
}

// ---------------------------------------------------------------------------
// Modalidades e valores
// ---------------------------------------------------------------------------

/** Modo efetivo do checkout, já considerando o caminho degradado de KYC. */
export type CheckoutMode = PaymentMode;

export interface ChargeableService {
  priceCents: number;
  paymentMode: PaymentMode;
  depositCents: number | null;
  depositPercent: number | null;
}

/**
 * Valor cobrado conforme a modalidade do serviço:
 *   - integral antecipado: o preço cheio;
 *   - sinal: valor fixo, senão percentual; sem configuração, cai para o integral
 *     (degradar para "cobra tudo" é melhor que travar o agendamento);
 *   - no local: zero (não há cobrança online).
 */
export function resolveChargeAmountCents(service: ChargeableService): number {
  if (service.paymentMode === 'ON_SITE') {
    return 0;
  }
  if (service.paymentMode === 'FULL_PREPAID') {
    return service.priceCents;
  }
  if (service.depositCents && service.depositCents > 0) {
    return Math.min(service.depositCents, service.priceCents);
  }
  if (service.depositPercent && service.depositPercent > 0) {
    return Math.round((service.priceCents * service.depositPercent) / 100);
  }
  return service.priceCents;
}

interface AccountSnapshot {
  asaasAccountId: string;
  walletId: string;
  kycStatus: string;
}

interface CheckoutRecord {
  bookingId: string;
  bookingStatus: BookingStatus;
  bookingCustomerId: string | null;
  holdSessionId: string | null;
  startsAt: Date;
  holdExpiresAt: Date | null;
  service: {
    id: string;
    name: string;
    durationMin: number;
    priceCents: number;
    paymentMode: PaymentMode;
    depositCents: number | null;
    depositPercent: number | null;
  };
  staffName: string;
  account: AccountSnapshot | null;
}

/**
 * Decide modalidade efetiva. KYC não aprovado (ou conta ausente) força
 * `ON_SITE` e marca `degraded` — é o caminho que impede o salão de travar
 * enquanto a subconta não é aprovada.
 */
export function resolveEffectiveMode(record: {
  service: ChargeableService;
  account: AccountSnapshot | null;
}): { mode: CheckoutMode; degraded: boolean } {
  if (record.service.paymentMode === 'ON_SITE') {
    return { mode: 'ON_SITE', degraded: false };
  }
  if (!record.account || record.account.kycStatus !== 'APPROVED') {
    return { mode: 'ON_SITE', degraded: true };
  }
  return { mode: record.service.paymentMode, degraded: false };
}

// ---------------------------------------------------------------------------
// Erros de domínio
// ---------------------------------------------------------------------------

export type CheckoutErrorCode =
  | 'INVALID_INPUT'
  | 'TENANT_UNAVAILABLE'
  | 'BOOKING_NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'CONFLICT'
  | 'HOLD_EXPIRED'
  | 'SERVICE_NOT_FOUND';

const ERROR_STATUS: Record<CheckoutErrorCode, number> = {
  INVALID_INPUT: 400,
  TENANT_UNAVAILABLE: 404,
  BOOKING_NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
  HOLD_EXPIRED: 409,
  SERVICE_NOT_FOUND: 404,
};

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode;
  readonly status: number;

  constructor(code: CheckoutErrorCode, message: string) {
    super(message);
    this.name = 'CheckoutError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

// ---------------------------------------------------------------------------
// Leitura do estado do checkout
// ---------------------------------------------------------------------------

async function loadCheckoutRecord(ctx: TenantContext, holdId: string): Promise<CheckoutRecord | null> {
  return ctx.forTenant(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: holdId, tenantId: ctx.tenant.id },
      select: {
        id: true,
        status: true,
        customerId: true,
        holdSessionId: true,
        startsAt: true,
        holdExpiresAt: true,
        serviceId: true,
        staffId: true,
      },
    });
    if (!booking) {
      return null;
    }

    // Consultas sequenciais de propósito: includes independentes do Prisma
    // disparam em paralelo na mesma conexão da transação (diagnóstico F0.2).
    const service = await tx.service.findFirst({
      where: { id: booking.serviceId, tenantId: ctx.tenant.id },
      select: {
        id: true,
        name: true,
        durationMin: true,
        priceCents: true,
        paymentMode: true,
        depositCents: true,
        depositPercent: true,
      },
    });
    if (!service) {
      return null;
    }

    const staff = await tx.staffProfile.findFirst({
      where: { id: booking.staffId, tenantId: ctx.tenant.id },
      select: { tenantMember: { select: { user: { select: { name: true } } } } },
    });

    const account = await tx.asaasAccount.findFirst({
      where: { tenantId: ctx.tenant.id },
      select: { asaasAccountId: true, walletId: true, kycStatus: true },
    });

    return {
      bookingId: booking.id,
      bookingStatus: booking.status,
      bookingCustomerId: booking.customerId,
      holdSessionId: booking.holdSessionId,
      startsAt: booking.startsAt,
      holdExpiresAt: booking.holdExpiresAt,
      service,
      staffName: staff?.tenantMember.user.name ?? 'Profissional',
      account,
    };
  });
}

function assertCheckoutable(
  record: CheckoutRecord,
  input: { memberId: string; holdSessionId?: string | null; enforceWindow: boolean; now: Date },
): void {
  if (record.bookingCustomerId && record.bookingCustomerId !== input.memberId) {
    throw new CheckoutError('CONFLICT', 'Este agendamento pertence a outro cliente.');
  }
  if (record.bookingStatus !== 'HOLD' && record.bookingStatus !== 'PENDING') {
    throw new CheckoutError('CONFLICT', 'Este agendamento não está mais aguardando pagamento.');
  }
  if (
    input.holdSessionId &&
    record.holdSessionId &&
    record.holdSessionId !== input.holdSessionId
  ) {
    throw new CheckoutError('CONFLICT', 'Este horário foi reservado em outro dispositivo.');
  }
  if (
    input.enforceWindow &&
    record.holdExpiresAt &&
    record.holdExpiresAt.getTime() <= input.now.getTime()
  ) {
    throw new CheckoutError(
      'HOLD_EXPIRED',
      'O tempo para concluir o pagamento terminou. Escolha o horário novamente.',
    );
  }
}

// ---------------------------------------------------------------------------
// Cotação (leitura, para a tela)
// ---------------------------------------------------------------------------

export interface CheckoutQuote {
  holdId: string;
  serviceId: string;
  serviceName: string;
  staffName: string;
  durationMin: number;
  startsAt: string;
  holdExpiresAt: string | null;
  timezone: string;
  paymentMode: PaymentMode;
  effectiveMode: CheckoutMode;
  degraded: boolean;
  priceCents: number;
  chargeAmountCents: number;
  platformFeeCents: number;
  depositCents: number | null;
  depositPercent: number | null;
}

export interface LoadCheckoutQuoteInput {
  ctx: TenantContext;
  holdId: string;
  memberId: string;
  holdSessionId?: string | null;
  now?: Date;
}

/**
 * Monta a cotação exibida na tela. NÃO cria cobrança e NÃO confirma: é leitura
 * pura, para o cliente ver valor, taxa e tempo restante antes de decidir.
 */
export async function loadCheckoutQuote(input: LoadCheckoutQuoteInput): Promise<CheckoutQuote> {
  const now = input.now ?? new Date();
  const record = await loadCheckoutRecord(input.ctx, input.holdId);
  if (!record) {
    throw new CheckoutError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
  }
  assertCheckoutable(record, {
    memberId: input.memberId,
    holdSessionId: input.holdSessionId ?? null,
    enforceWindow: false,
    now,
  });

  const effective = resolveEffectiveMode(record);
  const chargeAmountCents = resolveChargeAmountCents(record.service);

  return {
    holdId: record.bookingId,
    serviceId: record.service.id,
    serviceName: record.service.name,
    staffName: record.staffName,
    durationMin: record.service.durationMin,
    startsAt: record.startsAt.toISOString(),
    holdExpiresAt: record.holdExpiresAt?.toISOString() ?? null,
    timezone: input.ctx.tenant.timezone,
    paymentMode: record.service.paymentMode,
    effectiveMode: effective.mode,
    degraded: effective.degraded,
    priceCents: record.service.priceCents,
    chargeAmountCents: effective.mode === 'ON_SITE' ? 0 : chargeAmountCents,
    platformFeeCents:
      effective.mode === 'ON_SITE' ? 0 : computePlatformFeeCents(chargeAmountCents),
    depositCents: record.service.depositCents,
    depositPercent: record.service.depositPercent,
  };
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface CardInput {
  number: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

export interface StartCheckoutInput {
  ctx: TenantContext;
  holdId: string;
  memberId: string;
  method: PaymentMethod;
  card?: CardInput;
  /** IP do dispositivo do pagador (obrigatório no cartão). */
  remoteIp?: string | null;
  holdSessionId?: string | null;
  now?: Date;
}

export interface OnSiteCheckoutResult {
  kind: 'on_site';
  bookingId: string;
  /** `true` quando o KYC não aprovado forçou o pagamento no local. */
  degraded: boolean;
  alreadyConfirmed: boolean;
}

export interface ChargeCheckoutResult {
  kind: 'charge';
  paymentId: string;
  bookingId: string;
  method: PaymentMethod;
  amountCents: number;
  platformFeeCents: number;
  pixCopyPaste?: string;
  expiresAt?: string;
  cardLast4?: string;
}

export type CheckoutResult = OnSiteCheckoutResult | ChargeCheckoutResult;

function providerName(): string {
  return process.env.PAYMENT_PROVIDER?.trim() || 'mock';
}

function isAccountUnusable(error: unknown): boolean {
  return (
    error instanceof PaymentProviderError &&
    (error.code === 'KYC_NOT_APPROVED' || error.code === 'ACCOUNT_NOT_FOUND')
  );
}

/**
 * Confirma o agendamento sem cobrança (modalidade no local ou caminho
 * degradado). Idempotente: clique duplo devolve sucesso com o mesmo registro.
 */
async function confirmOnSite(
  ctx: TenantContext,
  holdId: string,
  memberId: string,
  now: Date,
): Promise<{ alreadyConfirmed: boolean }> {
  const booking = await ctx.forTenant((tx) =>
    tx.booking.findFirst({
      where: { id: holdId, tenantId: ctx.tenant.id },
      select: { id: true, customerId: true, status: true },
    }),
  );
  if (!booking) {
    throw new CheckoutError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
  }
  if (booking.customerId && booking.customerId !== memberId) {
    throw new CheckoutError('CONFLICT', 'Este agendamento pertence a outro cliente.');
  }
  if (booking.status === 'CONFIRMED') {
    return { alreadyConfirmed: true };
  }
  if (booking.status !== 'HOLD' && booking.status !== 'PENDING') {
    throw new CheckoutError('CONFLICT', 'Este agendamento não pode mais ser confirmado.');
  }

  try {
    await confirmBooking({ tenantId: ctx.tenant.id, bookingId: holdId, customerId: memberId, now });
  } catch (error) {
    if (error instanceof ConfirmBookingError) {
      if (error.code === 'BOOKING_NOT_FOUND') {
        throw new CheckoutError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
      }
      if (error.code === 'INVALID_STATE') {
        const after = await ctx.forTenant((tx) =>
          tx.booking.findFirst({
            where: { id: holdId, tenantId: ctx.tenant.id },
            select: { status: true, customerId: true },
          }),
        );
        if (after?.status === 'CONFIRMED' && after.customerId === memberId) {
          return { alreadyConfirmed: true };
        }
        throw new CheckoutError('CONFLICT', 'Este horário já foi confirmado.');
      }
    }
    throw error;
  }
  return { alreadyConfirmed: false };
}

/**
 * Executa o checkout do hold: cria a cobrança na subconta (integral ou sinal) ou
 * confirma no local. Para Pix/cartão, a confirmação do agendamento NÃO acontece
 * aqui — ela vem pelo webhook da F4.0 quando o pagamento é aprovado; e uma
 * recusa/Pix expirado devolve o slot.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<CheckoutResult> {
  const now = input.now ?? new Date();
  const { ctx, holdId, memberId } = input;

  if (!holdId) throw new CheckoutError('INVALID_INPUT', 'Informe o agendamento.');
  if (!memberId) throw new CheckoutError('UNAUTHENTICATED', 'Entre para pagar.');
  if (input.method !== 'PIX' && input.method !== 'CARD') {
    throw new CheckoutError('INVALID_INPUT', 'Forma de pagamento inválida.');
  }

  const record = await loadCheckoutRecord(ctx, holdId);
  if (!record) {
    throw new CheckoutError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
  }
  assertCheckoutable(record, {
    memberId,
    holdSessionId: input.holdSessionId ?? null,
    enforceWindow: true,
    now,
  });

  const effective = resolveEffectiveMode(record);
  if (effective.mode === 'ON_SITE') {
    const confirmed = await confirmOnSite(ctx, holdId, memberId, now);
    return {
      kind: 'on_site',
      bookingId: holdId,
      degraded: effective.degraded,
      alreadyConfirmed: confirmed.alreadyConfirmed,
    };
  }

  if (effective.mode === 'DEPOSIT' && input.method === 'CARD') {
    throw new CheckoutError('INVALID_INPUT', 'O sinal é pago via Pix; o saldo fica no local.');
  }
  if (!record.account) {
    // Defensivo: `resolveEffectiveMode` já teria forçado ON_SITE.
    throw new CheckoutError('CONFLICT', 'Conta de recebimento indisponível.');
  }

  const accountId = record.account.asaasAccountId;
  const amountCents = resolveChargeAmountCents(record.service);
  const platformFeeCents = computePlatformFeeCents(amountCents);
  const split = buildPlatformSplit(amountCents);
  const provider = getPaymentProvider();

  let cardToken: string | undefined;
  if (input.method === 'CARD') {
    if (!input.card) {
      throw new CheckoutError('INVALID_INPUT', 'Informe os dados do cartão.');
    }
    const tokenized = await provider.tokenizeCard({
      accountId,
      customerId: memberId,
      number: input.card.number,
      holderName: input.card.holderName,
      expiryMonth: input.card.expiryMonth,
      expiryYear: input.card.expiryYear,
      ccv: input.card.ccv,
      remoteIp: input.remoteIp ?? '',
    });
    cardToken = tokenized.token;
  }

  let charge: Charge;
  try {
    charge = await provider.createCharge({
      // SEMPRE a subconta do tenant. O accountId não vem do chamador.
      accountId,
      customerId: memberId,
      method: input.method,
      amountCents,
      dueDate: tenantDateString(now, ctx.tenant.timezone),
      description: record.service.name,
      externalReference: holdId,
      split,
      ...(cardToken ? { cardToken } : {}),
      ...(input.remoteIp ? { remoteIp: input.remoteIp } : {}),
    });
  } catch (error) {
    if (isAccountUnusable(error)) {
      // Subconta não utilizável no provedor: degrada para ON_SITE sem travar.
      const confirmed = await confirmOnSite(ctx, holdId, memberId, now);
      return {
        kind: 'on_site',
        bookingId: holdId,
        degraded: true,
        alreadyConfirmed: confirmed.alreadyConfirmed,
      };
    }
    throw error;
  }

  const payment = await ctx.forTenant(async (tx) => {
    const booking = await tx.booking.findFirst({
      where: { id: holdId, tenantId: ctx.tenant.id },
      select: { id: true, customerId: true, status: true },
    });
    if (!booking) {
      throw new CheckoutError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
    }
    if (booking.status !== 'HOLD' && booking.status !== 'PENDING') {
      throw new CheckoutError('CONFLICT', 'Este agendamento não está mais aguardando pagamento.');
    }
    if (booking.customerId && booking.customerId !== memberId) {
      throw new CheckoutError('CONFLICT', 'Este agendamento pertence a outro cliente.');
    }
    if (!booking.customerId) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { customerId: memberId },
      });
    }
    return tx.payment.create({
      data: {
        tenantId: ctx.tenant.id,
        bookingId: booking.id,
        provider: providerName(),
        method: input.method,
        amountCents,
        platformFeeCents,
        asaasId: charge.id,
        status: 'PENDING',
      },
    });
  });

  return {
    kind: 'charge',
    paymentId: payment.id,
    bookingId: holdId,
    method: input.method,
    amountCents,
    platformFeeCents,
    ...(charge.pixCopyPaste ? { pixCopyPaste: charge.pixCopyPaste } : {}),
    ...(charge.expiresAt ? { expiresAt: charge.expiresAt } : {}),
    ...(charge.cardLast4 ? { cardLast4: charge.cardLast4 } : {}),
  };
}

/** Data de calendário do tenant ("YYYY-MM-DD") — o vencimento é local, não UTC. */
export function tenantDateString(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}
