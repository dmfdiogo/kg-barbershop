import type { BookingStatus, PaymentStatus } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import { getPaymentProvider } from './index';
import { PaymentProviderError, type PaymentProvider } from './types';

/**
 * Estorno pela política de cancelamento do tenant (tarefa F4.3).
 *
 * O produto promete que o dono não abre o painel do Asaas: o estorno dos
 * pagamentos antecipados (integral ou sinal) sai daqui, dentro do painel, e o
 * dinheiro volta pela subconta. O valor é SEMPRE inteiro em centavos — nenhuma
 * conversão para float no meio, que é o jeito clássico de perder um centavo.
 *
 * A POLÍTICA É DERIVADA DO TENANT, NÃO FIXA NO CÓDIGO. `Tenant.cancellationWindowHours`
 * (padrão 24h) define quanta antecedência o cliente precisa dar para que o
 * cancelamento dê direito a estorno. A decisão vive numa função PURA
 * (`resolveRefundCap`) para ser testada sem banco e sem provedor.
 *
 * POLÍTICA ADOTADA (produto ainda em aberto — plano §9, item 3): cancelamento
 * com pelo menos `cancellationWindowHours` de antecedência devolve integralmente
 * o que ainda não foi estornado; cancelamento tardio, no-show ou agendamento
 * não cancelado não dão estorno automático. O dono pode fazer um estorno
 * PARCIAL de até o teto da política (boa-vontade), mas nunca acima dele.
 *
 * DUAS FASES COMO NO RESTO DA FASE 4. Lê o estado escopado, fecha a transação e
 * SÓ ENTÃO chama o provedor — chamada externa não entra na callback reexecutável
 * do client escopado. O provedor dispara o webhook, e é o processador da F4.0
 * que grava o lançamento e o novo estado: nenhum efeito síncrono do provedor é
 * tratado como verdade.
 */

export interface RefundDb {
  forTenant<T>(
    tenantId: string,
    fn: (tx: TenantTransaction) => Promise<T>,
  ): Promise<T>;
}

export type RefundPolicy =
  | 'ELIGIBLE'
  | 'LATE_CANCELLATION'
  | 'NOT_CANCELLED'
  | 'NOTHING_TO_REFUND';

export interface RefundCapInput {
  /** Saldo ainda estornável: `amountCents − lançamentos já registrados`. */
  remainingCents: number;
  bookingStatus: BookingStatus;
  startsAt: Date;
  cancelledAt: Date | null;
  cancellationWindowHours: number;
}

export interface RefundCap {
  policy: RefundPolicy;
  /** Teto permitido pela política; 0 quando não há estorno devido. */
  maxRefundableCents: number;
  /** Frase para o painel explicar a decisão. */
  summary: string;
}

/**
 * Decisão PURA da política de estorno do tenant. Recebe o saldo estornável e o
 * estado do agendamento; não toca em banco nem em provedor.
 */
export function resolveRefundCap(input: RefundCapInput): RefundCap {
  const remaining = Math.max(Math.trunc(input.remainingCents), 0);

  if (remaining <= 0) {
    return {
      policy: 'NOTHING_TO_REFUND',
      maxRefundableCents: 0,
      summary: 'Este pagamento já foi estornado por inteiro.',
    };
  }

  if (input.bookingStatus !== 'CANCELLED') {
    return {
      policy: 'NOT_CANCELLED',
      maxRefundableCents: 0,
      summary:
        'Só agendamentos cancelados dão direito a estorno. Cancele o agendamento e tente de novo.',
    };
  }

  if (!input.cancelledAt) {
    return {
      policy: 'LATE_CANCELLATION',
      maxRefundableCents: 0,
      summary: 'Cancelamento sem registro de horário não dá direito a estorno.',
    };
  }

  const deadlineMs =
    input.startsAt.getTime() - Math.max(input.cancellationWindowHours, 0) * 3_600_000;
  if (input.cancelledAt.getTime() <= deadlineMs) {
    return {
      policy: 'ELIGIBLE',
      maxRefundableCents: remaining,
      summary: `Cancelamento dentro da política (${input.cancellationWindowHours}h de antecedência): estorno liberado até ${formatCentsForSummary(remaining)}.`,
    };
  }

  return {
    policy: 'LATE_CANCELLATION',
    maxRefundableCents: 0,
    summary: `Cancelamento com menos de ${input.cancellationWindowHours}h de antecedência não dá direito a estorno.`,
  };
}

/** Formata centavos só para compor a frase da política (a UI usa lib/money). */
function formatCentsForSummary(cents: number): string {
  const reais = Math.trunc(cents / 100);
  const centavos = cents % 100;
  return `R$ ${reais},${String(centavos).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

export type RefundErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_STATE'
  | 'NOT_REFUNDABLE'
  | 'INVALID_AMOUNT'
  | 'EXCEEDS_REFUNDABLE'
  | 'PROVIDER_ERROR';

const ERROR_STATUS: Record<RefundErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  NOT_REFUNDABLE: 409,
  INVALID_AMOUNT: 400,
  EXCEEDS_REFUNDABLE: 400,
  PROVIDER_ERROR: 502,
};

export class RefundError extends Error {
  readonly code: RefundErrorCode;
  readonly status: number;

  constructor(code: RefundErrorCode, message: string) {
    super(message);
    this.name = 'RefundError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export interface RefundPaymentInput {
  db: RefundDb;
  tenantId: string;
  paymentId: string;
  /**
   * Valor do estorno em centavos. `null`/ausente = estorna o teto da política
   * (integral quando o agendamento foi cancelado dentro da janela).
   */
  amountCents?: number | null;
  /** Injetável em teste; o produto usa a factory por env. */
  provider?: PaymentProvider;
}

export interface RefundResult {
  paymentId: string;
  amountCents: number;
  providerRefundId: string;
  policy: RefundPolicy;
  /** Lançamentos já registrados antes deste pedido. */
  alreadyRefundedCents: number;
  /** Teto da política no momento do pedido. */
  maxRefundableCents: number;
}

interface RefundSnapshot {
  payment: {
    id: string;
    status: PaymentStatus;
    amountCents: number;
    asaasId: string | null;
    bookingId: string;
  };
  booking: {
    status: BookingStatus;
    startsAt: Date;
    cancelledAt: Date | null;
  };
  alreadyRefundedCents: number;
  cancellationWindowHours: number;
}

const REFUNDABLE_STATUSES: readonly PaymentStatus[] = ['PAID', 'PARTIALLY_REFUNDED'];

/**
 * Executa o estorno. Idempotência real NÃO é responsabilidade daqui: o provedor
 * recusa valor acima do saldo estornável (a divergência chega como
 * `REFUND_EXCEEDS_AMOUNT`) e o lançamento local nasce no webhook. Chamar duas
 * vezes com o mesmo valor falha na segunda, sem duplicar dinheiro.
 */
export async function refundPayment(input: RefundPaymentInput): Promise<RefundResult> {
  const snapshot = await input.db.forTenant(input.tenantId, async (tx) => {
    const payment = await tx.payment.findFirst({
      where: { id: input.paymentId, tenantId: input.tenantId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        asaasId: true,
        bookingId: true,
      },
    });
    if (!payment) {
      throw new RefundError('NOT_FOUND', 'Pagamento não encontrado para este estabelecimento.');
    }

    const booking = await tx.booking.findFirst({
      where: { id: payment.bookingId, tenantId: input.tenantId },
      select: { status: true, startsAt: true, cancelledAt: true },
    });
    if (!booking) {
      throw new RefundError('NOT_FOUND', 'Agendamento do pagamento não encontrado.');
    }

    const aggregate = await tx.refund.aggregate({
      where: { paymentId: payment.id },
      _sum: { amountCents: true },
    });

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: input.tenantId },
      select: { cancellationWindowHours: true },
    });

    return {
      payment,
      booking,
      alreadyRefundedCents: aggregate._sum.amountCents ?? 0,
      cancellationWindowHours: tenant.cancellationWindowHours,
    } satisfies RefundSnapshot;
  });

  const { payment, booking, alreadyRefundedCents } = snapshot;
  if (!REFUNDABLE_STATUSES.includes(payment.status)) {
    throw new RefundError(
      'INVALID_STATE',
      'Só pagamentos aprovados podem ser estornados.',
    );
  }
  if (!payment.asaasId) {
    throw new RefundError('INVALID_STATE', 'Pagamento sem cobrança no provedor.');
  }

  const cap = resolveRefundCap({
    remainingCents: payment.amountCents - alreadyRefundedCents,
    bookingStatus: booking.status,
    startsAt: booking.startsAt,
    cancelledAt: booking.cancelledAt,
    cancellationWindowHours: snapshot.cancellationWindowHours,
  });

  if (cap.maxRefundableCents <= 0) {
    throw new RefundError('NOT_REFUNDABLE', cap.summary);
  }

  const requested = input.amountCents ?? cap.maxRefundableCents;
  if (!Number.isInteger(requested) || requested <= 0) {
    throw new RefundError('INVALID_AMOUNT', 'Informe um valor de estorno em centavos maior que zero.');
  }
  if (requested > cap.maxRefundableCents) {
    throw new RefundError(
      'EXCEEDS_REFUNDABLE',
      `O valor máximo para estorno é ${formatCentsForSummary(cap.maxRefundableCents)}.`,
    );
  }

  const provider = input.provider ?? getPaymentProvider();
  try {
    const refund = await provider.refund(payment.asaasId, requested);
    return {
      paymentId: payment.id,
      amountCents: requested,
      providerRefundId: refund.id,
      policy: cap.policy,
      alreadyRefundedCents,
      maxRefundableCents: cap.maxRefundableCents,
    };
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      throw new RefundError(
        'PROVIDER_ERROR',
        `O provedor recusou o estorno: ${error.message}`,
      );
    }
    throw error;
  }
}
