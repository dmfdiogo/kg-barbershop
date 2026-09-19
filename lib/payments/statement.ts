import type { BookingStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import {
  loadMerchantAccount,
  resolveReceivingCapability,
  type ReceivingCapability,
} from './merchant';
import { resolveRefundCap, type RefundDb, type RefundPolicy } from './refund';

/**
 * Saldo e extrato do estabelecimento (tarefa F4.3).
 *
 * A spec §3.2 promete que o dono NÃO abre o painel do Asaas: saldo e extrato
 * saem daqui. O saldo é derivado dos `Payment`/`Refund` locais — cada crédito e
 * cada estorno é um lançamento — e não de uma chamada síncrona ao provedor: o
 * webhook é a fonte de verdade, e o extrato do tenant A nunca enxerga o do B
 * porque tudo passa pelo client escopado (RLS).
 *
 * O que conta como saldo espelha o `getBalance` do provedor (mock até a F8):
 *   - DISPONÍVEL: pagamentos aprovados menos os estornos já lançados;
 *   - A LIBERAR: cobranças ainda pendentes de confirmação.
 * Pagamento recusado/expirado aparece no extrato como histórico, sem compor
 * nenhum dos dois saldos.
 *
 * O saldo é a soma dos lançamentos, nunca um contador mutável — mesma escolha do
 * `credit_ledger` (F5). Um estorno parcial repetido vira uma linha por evento e
 * a soma continua correta.
 */

export type StatementDb = RefundDb;

export type StatementEntryKind = 'PAYMENT' | 'REFUND';

export interface StatementRefundInfo {
  remainingCents: number;
  maxRefundableCents: number;
  policy: RefundPolicy;
  summary: string;
}

export interface StatementEntry {
  id: string;
  kind: StatementEntryKind;
  occurredAt: string;
  description: string;
  /** Assinado: crédito positivo, estorno negativo. */
  amountCents: number;
  status: PaymentStatus | null;
  method: PaymentMethod | null;
  paymentId: string;
  bookingId: string | null;
  customerName: string | null;
  /** Total já estornado do pagamento a que a linha se refere. */
  refundedCents: number;
  /** Presente só em lançamentos de pagamento que ainda podem ser estornados. */
  refund: StatementRefundInfo | null;
}

export interface FinancialOverview {
  /** Pagamentos aprovados menos estornos. */
  availableCents: number;
  /** Cobranças aguardando confirmação. */
  pendingCents: number;
  /** Total aprovado, antes de estornos. */
  paidCents: number;
  /** Total estornado. */
  refundedCents: number;
  entries: StatementEntry[];
  receiving: ReceivingCapability;
}

const AVAILABLE_STATUSES: readonly PaymentStatus[] = [
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
];

export interface LoadFinancialOverviewOptions {
  /** Limita o extrato às N entradas mais recentes. Sem limite por padrão. */
  entryLimit?: number;
}

/**
 * Monta saldo, extrato e situação do recebimento numa única leitura escopada.
 * Queries sequenciais de propósito: `include` independentes do Prisma disparam
 * em paralelo na mesma conexão da transação interativa (diagnóstico da F0.2).
 */
export async function loadFinancialOverview(
  db: StatementDb,
  tenantId: string,
  options: LoadFinancialOverviewOptions = {},
): Promise<FinancialOverview> {
  return db.forTenant(tenantId, async (tx) => {
    const account = await loadMerchantAccount(tx, tenantId);
    const receiving = resolveReceivingCapability(account);
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { cancellationWindowHours: true },
    });

    const payments = await tx.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        bookingId: true,
        method: true,
        amountCents: true,
        status: true,
        paidAt: true,
        createdAt: true,
      },
    });

    const refunds = await tx.refund.findMany({
      where: { tenantId },
      orderBy: { occurredAt: 'desc' },
      select: {
        id: true,
        paymentId: true,
        amountCents: true,
        occurredAt: true,
      },
    });

    const refundedByPayment = new Map<string, number>();
    for (const refund of refunds) {
      refundedByPayment.set(
        refund.paymentId,
        (refundedByPayment.get(refund.paymentId) ?? 0) + refund.amountCents,
      );
    }

    const descriptions = await loadPaymentDescriptions(tx, payments.map((p) => p.bookingId));

    let availableCents = 0;
    let pendingCents = 0;
    let paidCents = 0;
    let refundedCents = 0;

    const entries: StatementEntry[] = [];

    for (const payment of payments) {
      const refunded = refundedByPayment.get(payment.id) ?? 0;
      const detail = descriptions.get(payment.bookingId) ?? null;
      const label = detail?.serviceName ?? 'Atendimento';

      if (AVAILABLE_STATUSES.includes(payment.status)) {
        paidCents += payment.amountCents;
        availableCents += Math.max(payment.amountCents - refunded, 0);
      } else if (payment.status === 'PENDING') {
        pendingCents += payment.amountCents;
      }
      refundedCents += refunded;

      const refund = buildRefundInfo({
        paymentStatus: payment.status,
        amountCents: payment.amountCents,
        refundedCents: refunded,
        detail,
        cancellationWindowHours: tenant.cancellationWindowHours,
      });

      entries.push({
        id: `payment:${payment.id}`,
        kind: 'PAYMENT',
        occurredAt: (payment.paidAt ?? payment.createdAt).toISOString(),
        description: label,
        amountCents: payment.amountCents,
        status: payment.status,
        method: payment.method,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        customerName: detail?.customerName ?? null,
        refundedCents: refunded,
        refund,
      });
    }

    for (const refund of refunds) {
      const payment = payments.find((candidate) => candidate.id === refund.paymentId);
      const detail = payment ? descriptions.get(payment.bookingId) ?? null : null;
      entries.push({
        id: `refund:${refund.id}`,
        kind: 'REFUND',
        occurredAt: refund.occurredAt.toISOString(),
        description: `Estorno — ${detail?.serviceName ?? 'Atendimento'}`,
        amountCents: -refund.amountCents,
        status: null,
        method: null,
        paymentId: refund.paymentId,
        bookingId: payment?.bookingId ?? null,
        customerName: detail?.customerName ?? null,
        refundedCents: refundedByPayment.get(refund.paymentId) ?? 0,
        refund: null,
      });
    }

    entries.sort((a, b) => {
      const diff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
      return diff !== 0 ? diff : a.id.localeCompare(b.id, 'en');
    });

    return {
      availableCents,
      pendingCents,
      paidCents,
      refundedCents,
      entries:
        options.entryLimit !== undefined ? entries.slice(0, options.entryLimit) : entries,
      receiving,
    };
  });
}

interface PaymentDescription {
  serviceName: string;
  customerName: string | null;
  bookingStatus: BookingStatus;
  startsAt: Date;
  cancelledAt: Date | null;
}

async function loadPaymentDescriptions(
  tx: TenantTransaction,
  bookingIds: string[],
): Promise<Map<string, PaymentDescription>> {
  const unique = [...new Set(bookingIds)];
  const map = new Map<string, PaymentDescription>();
  if (unique.length === 0) {
    return map;
  }

  const bookings = await tx.booking.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      status: true,
      startsAt: true,
      cancelledAt: true,
      service: { select: { name: true } },
      customer: { select: { user: { select: { name: true } } } },
    },
  });

  for (const booking of bookings) {
    map.set(booking.id, {
      serviceName: booking.service.name,
      customerName: booking.customer?.user.name ?? null,
      bookingStatus: booking.status,
      startsAt: booking.startsAt,
      cancelledAt: booking.cancelledAt,
    });
  }
  return map;
}

function buildRefundInfo(input: {
  paymentStatus: PaymentStatus;
  amountCents: number;
  refundedCents: number;
  detail: PaymentDescription | null;
  cancellationWindowHours: number;
}): StatementRefundInfo | null {
  if (!AVAILABLE_STATUSES.includes(input.paymentStatus) || !input.detail) {
    return null;
  }

  const cap = resolveRefundCap({
    remainingCents: input.amountCents - input.refundedCents,
    bookingStatus: input.detail.bookingStatus,
    startsAt: input.detail.startsAt,
    cancelledAt: input.detail.cancelledAt,
    cancellationWindowHours: input.cancellationWindowHours,
  });

  return {
    remainingCents: Math.max(input.amountCents - input.refundedCents, 0),
    maxRefundableCents: cap.maxRefundableCents,
    policy: cap.policy,
    summary: cap.summary,
  };
}
