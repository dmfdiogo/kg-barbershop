import type { PaymentMethod, PaymentStatus } from '@prisma/client';
import { formatCents } from '@/lib/money';
import type { StatementEntry } from '@/lib/payments/statement';
import { RefundButton } from './RefundButton';

/**
 * Extrato do estabelecimento (tarefa F4.3).
 *
 * Cada pagamento é um lançamento de crédito e cada estorno um de débito. O dono
 * vê o que entrou, o que foi devolvido e — quando o agendamento cancelado dá
 * direito — estorna ali mesmo, sem abrir o painel do provedor (spec §3.2).
 */

const STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: 'Aguardando',
  PAID: 'Pago',
  FAILED: 'Recusado',
  EXPIRED: 'Expirado',
  REFUNDED: 'Estornado',
  PARTIALLY_REFUNDED: 'Parcialmente estornado',
};

const STATUS_CLASS: Record<PaymentStatus, string> = {
  PENDING: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  PAID: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  FAILED: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  EXPIRED: 'bg-[var(--color-muted)] text-[var(--color-secondary)]',
  REFUNDED: 'bg-[var(--color-muted)] text-[var(--color-secondary)]',
  PARTIALLY_REFUNDED: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
};

const METHOD_LABEL: Record<PaymentMethod, string> = {
  PIX: 'Pix',
  CARD: 'Cartão',
  CASH: 'Dinheiro',
};

export interface StatementProps {
  entries: StatementEntry[];
  timezone: string;
  /** Habilita o botão de estorno (só na tela de extrato do OWNER). */
  allowRefund?: boolean;
}

export function Statement({ entries, timezone, allowRefund = false }: StatementProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-secondary)]">
        Nenhum lançamento por aqui ainda. Os pagamentos dos seus clientes aparecem
        neste extrato.
      </p>
    );
  }

  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{entry.description}</p>
              <p className="mt-0.5 text-xs text-[var(--color-secondary)]">
                {formatter.format(new Date(entry.occurredAt))}
                {entry.customerName ? ` · ${entry.customerName}` : ''}
                {entry.method ? ` · ${METHOD_LABEL[entry.method]}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span
                className={
                  entry.kind === 'REFUND'
                    ? 'text-sm font-semibold tabular-nums text-[var(--color-danger)]'
                    : 'text-sm font-semibold tabular-nums text-[var(--color-success)]'
                }
              >
                {entry.kind === 'REFUND' ? '' : '+'}
                {formatCents(entry.amountCents)}
              </span>
              {entry.status ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[entry.status]}`}
                >
                  {STATUS_LABEL[entry.status]}
                </span>
              ) : null}
            </div>
          </div>

          {entry.kind === 'PAYMENT' && entry.refundedCents > 0 ? (
            <p className="text-xs text-[var(--color-secondary)]">
              Estornado deste pagamento: {formatCents(entry.refundedCents)}
            </p>
          ) : null}

          {allowRefund && entry.refund && entry.refund.maxRefundableCents > 0 ? (
            <div>
              <RefundButton
                paymentId={entry.paymentId}
                maxRefundableCents={entry.refund.maxRefundableCents}
              />
              <p className="mt-1 text-xs text-[var(--color-secondary)]">{entry.refund.summary}</p>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
