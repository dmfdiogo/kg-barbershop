import type { BookingStatus, PaymentStatus } from '@prisma/client';
import type {
  PaymentWebhookChargeData,
  PaymentWebhookEventType,
} from './webhook';

/**
 * Máquina de estados `Booking` × `Payment` (tarefa F4.0).
 *
 * Este módulo é PURO de propósito: não conhece banco, Prisma Client, HTTP nem o
 * store do mock. É a única fonte de verdade das transições permitidas e
 * proibidas, e é o que torna possível testar a decisão "por estado final, não
 * por ordem de chegada" sem subir Postgres.
 *
 * Quem persiste é `app/api/webhooks/payments/processor.ts`, que lê o estado
 * local e consulta as funções daqui:
 *
 *   - `planPaymentTransition` decide o próximo `Payment.status` e o efeito no
 *     agendamento, confrontando o payload com o registro local;
 *   - `resolveBookingConfirmation` / `resolveBookingRelease` decidem o efeito no
 *     `Booking`.
 *
 * POR QUE MONOTÔNICO. Webhooks chegam fora de ordem. Em vez de acreditar na
 * ordem de entrega, cada evento é comparado com o estado LOCAL: uma transição
 * só aplica se estiver na tabela de permitidas. Evento que andaria para trás
 * (uma confirmação que chega depois de um estorno) é `ignored` — registrado e
 * respondido com 200, mas sem regredir o estado. É a diferença entre "chegou
 * depois" e "vale mais".
 *
 * VALOR DO PAYLOAD É ENTRADA NÃO CONFIÁVEL. Antes de qualquer decisão, o valor
 * em centavos do payload é confrontado com `Payment.amountCents`, e a
 * consistência de `refundedCents` com o tipo do evento (integral x parcial).
 * Divergência lança `PaymentWebhookValidationError` — a única resposta correta
 * para um payload adulterado é recusá-lo, nunca creditar com base nele.
 */

export class PaymentWebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentWebhookValidationError';
  }
}

/**
 * Transições de `Payment.status` PERMITIDAS (não inclui a auto-transição: estado
 * local igual ao alvo é tratado como evento já aplicado, não como transição).
 *
 * As "voltas no tempo" vivem nas transições de entrada: `PENDING → REFUNDED` e
 * `PENDING → PARTIALLY_REFUNDED` existem porque um estorno pode ser o primeiro
 * evento que a aplicação recebe — no provedor ele só é possível depois de pago,
 * então o estado final correto é "estornado", mesmo sem ter passado por
 * `PAID` localmente. O fluxo contrário (`REFUNDED → PAID`) NÃO existe.
 */
export const PERMITTED_PAYMENT_TRANSITIONS: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  PENDING: ['PAID', 'FAILED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED'],
  PAID: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED'],
  FAILED: [],
  EXPIRED: [],
  REFUNDED: [],
};

/** Estados terminais: nenhuma transição sai deles. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'FAILED',
  'EXPIRED',
  'REFUNDED',
];

const ALL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

export interface PaymentTransitionPair {
  readonly from: PaymentStatus;
  readonly to: PaymentStatus;
}

/**
 * Transições PROIBIDAS, explícitas e derivadas: todo par ordenado (from ≠ to)
 * que não está em `PERMITTED_PAYMENT_TRANSITIONS`. É o que a decisão "por
 * estado final" consulta — proibida significa "registra o evento e não regride".
 */
export const PROHIBITED_PAYMENT_TRANSITIONS: readonly PaymentTransitionPair[] =
  ALL_PAYMENT_STATUSES.flatMap((from) =>
    ALL_PAYMENT_STATUSES.filter(
      (to) => to !== from && !PERMITTED_PAYMENT_TRANSITIONS[from].includes(to),
    ).map((to) => ({ from, to })),
  );

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PERMITTED_PAYMENT_TRANSITIONS[from].includes(to);
}

/** Alvo de cada tipo de evento. `MERCHANT_KYC_UPDATED` não mexe em pagamento. */
export const PAYMENT_EVENT_TARGET: Readonly<
  Partial<Record<PaymentWebhookEventType, PaymentStatus>>
> = {
  CHARGE_PAID: 'PAID',
  CHARGE_REFUSED: 'FAILED',
  CHARGE_EXPIRED: 'EXPIRED',
  CHARGE_REFUNDED: 'REFUNDED',
  CHARGE_PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
};

export interface LocalPaymentState {
  status: PaymentStatus;
  amountCents: number;
  paidAt: Date | null;
  asaasId: string | null;
}

export type PaymentBookingEffect = 'confirm' | 'release' | 'none';

export function bookingEffectForPaymentStatus(status: PaymentStatus): PaymentBookingEffect {
  switch (status) {
    case 'PAID':
      return 'confirm';
    case 'FAILED':
    case 'EXPIRED':
      return 'release';
    case 'PENDING':
    case 'REFUNDED':
    case 'PARTIALLY_REFUNDED':
      return 'none';
  }
}

export type PaymentTransitionPlan =
  | { kind: 'already-applied'; status: PaymentStatus; bookingEffect: PaymentBookingEffect }
  | {
      kind: 'applied';
      status: PaymentStatus;
      bookingEffect: PaymentBookingEffect;
      paidAt: Date | null;
    }
  | {
      kind: 'ignored';
      reason: 'stale' | 'terminal';
      current: PaymentStatus;
      incoming: PaymentStatus;
    };

/**
 * Confronta o payload com o registro local. Não retorna nada: ou é consistente,
 * ou lança. É a barreira que impede creditar com base no que o caller mandou.
 */
export function validateChargeAgainstLocal(
  local: Pick<LocalPaymentState, 'amountCents'>,
  charge: PaymentWebhookChargeData,
  eventType: PaymentWebhookEventType,
): void {
  if (!Number.isInteger(charge.amountCents)) {
    throw new PaymentWebhookValidationError('amountCents do payload não é inteiro em centavos.');
  }
  if (charge.amountCents !== local.amountCents) {
    throw new PaymentWebhookValidationError(
      `Valor do payload (${charge.amountCents}) diverge do registro local (${local.amountCents}).`,
    );
  }
  if (!Number.isInteger(charge.refundedCents) || charge.refundedCents < 0) {
    throw new PaymentWebhookValidationError('refundedCents do payload é inválido.');
  }

  switch (eventType) {
    case 'CHARGE_PAID':
    case 'CHARGE_REFUSED':
    case 'CHARGE_EXPIRED':
      if (charge.refundedCents !== 0) {
        throw new PaymentWebhookValidationError(
          `Evento ${eventType} não admite valor estornado (${charge.refundedCents}).`,
        );
      }
      break;
    case 'CHARGE_PARTIALLY_REFUNDED':
      if (charge.refundedCents <= 0 || charge.refundedCents >= charge.amountCents) {
        throw new PaymentWebhookValidationError(
          `Estorno parcial exige 0 < refundedCents < ${charge.amountCents} (recebido: ${charge.refundedCents}).`,
        );
      }
      break;
    case 'CHARGE_REFUNDED':
      if (charge.refundedCents !== charge.amountCents) {
        throw new PaymentWebhookValidationError(
          `Estorno total exige refundedCents === ${charge.amountCents} (recebido: ${charge.refundedCents}).`,
        );
      }
      break;
    case 'MERCHANT_KYC_UPDATED':
      throw new PaymentWebhookValidationError('MERCHANT_KYC_UPDATED não é evento de cobrança.');
  }
}

/**
 * Decide o que fazer com um evento de cobrança, dado o pagamento LOCAL.
 * `already-applied` e `ignored` são sucessos idempotentes: o evento é registrado
 * e respondido com 200, sem novo efeito.
 */
export function planPaymentTransition(
  local: LocalPaymentState,
  event: { type: PaymentWebhookEventType; occurredAt: string; charge: PaymentWebhookChargeData },
): PaymentTransitionPlan {
  const incoming = PAYMENT_EVENT_TARGET[event.type];
  if (!incoming) {
    throw new PaymentWebhookValidationError(`Evento ${event.type} não altera pagamento.`);
  }

  validateChargeAgainstLocal(local, event.charge, event.type);

  if (local.status === incoming) {
    // Estorno parcial é o único alvo que se repete legitimamente: cada evento
    // com eventId próprio é um novo estorno, então aplica de novo (o efeito no
    // status é o mesmo). Os demais são reentrega do mesmo estado — no-op.
    if (incoming === 'PARTIALLY_REFUNDED') {
      return {
        kind: 'applied',
        status: incoming,
        bookingEffect: 'none',
        paidAt: resolvePaidAt(local, event, incoming),
      };
    }
    return {
      kind: 'already-applied',
      status: incoming,
      bookingEffect: bookingEffectForPaymentStatus(incoming),
    };
  }

  if (!canTransitionPayment(local.status, incoming)) {
    return {
      kind: 'ignored',
      reason: TERMINAL_PAYMENT_STATUSES.includes(local.status) ? 'terminal' : 'stale',
      current: local.status,
      incoming,
    };
  }

  const paidAt = resolvePaidAt(local, event, incoming);
  return {
    kind: 'applied',
    status: incoming,
    bookingEffect: bookingEffectForPaymentStatus(incoming),
    paidAt,
  };
}

function resolvePaidAt(
  local: LocalPaymentState,
  event: { occurredAt: string; charge: PaymentWebhookChargeData },
  incoming: PaymentStatus,
): Date | null {
  if (incoming !== 'PAID') {
    // Estorno chega com `paidAt` no payload do provedor; é metadado, não valor
    // de dinheiro, então pode ser aproveitado. Sem ele, preserva o local.
    if (local.paidAt) return local.paidAt;
    if (event.charge.paidAt) return new Date(event.charge.paidAt);
    return null;
  }
  if (event.charge.paidAt) return new Date(event.charge.paidAt);
  if (local.paidAt) return local.paidAt;
  return new Date(event.occurredAt);
}

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

/**
 * Transições de `Booking.status` permitidas (não inclui auto-transição).
 * O webhook só usa `CONFIRMED` (pagamento aprovado) e `CANCELLED` (pagamento
 * recusado/expirado, que devolve o slot — a exclusion constraint só cobre
 * HOLD/PENDING/CONFIRMED).
 */
export const PERMITTED_BOOKING_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  HOLD: ['PENDING', 'CONFIRMED', 'CANCELLED'],
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransitionBooking(from: BookingStatus, to: BookingStatus): boolean {
  return PERMITTED_BOOKING_TRANSITIONS[from].includes(to);
}

export type BookingResolution =
  | { kind: 'confirmed' }
  | { kind: 'cancelled' }
  | { kind: 'already-applied'; status: BookingStatus }
  | { kind: 'ignored'; status: BookingStatus };

/**
 * Efeito `confirm` (pagamento aprovado): HOLD/PENDING viram CONFIRMED.
 *
 * Um agendamento já CONFIRMED é `already-applied` (reentrega). Os demais —
 * inclusive CANCELLED/COMPLETED/NO_SHOW — são `ignored`: pagamento tardio não
 * reabre um agendamento que o salão já encerrou.
 */
export function resolveBookingConfirmation(status: BookingStatus): BookingResolution {
  if (status === 'CONFIRMED') return { kind: 'already-applied', status };
  if (status === 'HOLD' || status === 'PENDING') return { kind: 'confirmed' };
  return { kind: 'ignored', status };
}

/**
 * Efeito `release` (pagamento recusado/expirado): SÓ HOLD/PENDING viram
 * CANCELLED. Deliberadamente mais estreito que a máquina geral de Booking: o
 * cancelamento pelo cliente (F3.4) pode partir de CONFIRMED, mas uma recusa de
 * pagamento atrasada NÃO pode derrubar um agendamento já confirmado.
 */
export function resolveBookingRelease(status: BookingStatus): BookingResolution {
  if (status === 'CANCELLED') return { kind: 'already-applied', status };
  if (status === 'HOLD' || status === 'PENDING') return { kind: 'cancelled' };
  return { kind: 'ignored', status };
}
