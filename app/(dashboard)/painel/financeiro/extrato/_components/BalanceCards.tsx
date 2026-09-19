import { formatCents } from '@/lib/money';

/**
 * Cartões de saldo (tarefa F4.3).
 *
 * "Disponível" é o que o dono pode sacar; "a liberar" é o que ainda depende de
 * confirmação. A distinção existe para o dono não confundir uma cobrança
 * pendente com dinheiro em conta — o mock (e o Asaas) separam os dois.
 */

export interface BalanceCardsProps {
  availableCents: number;
  pendingCents: number;
  paidCents: number;
  refundedCents: number;
}

export function BalanceCards({
  availableCents,
  pendingCents,
  paidCents,
  refundedCents,
}: BalanceCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Disponível"
        value={formatCents(availableCents)}
        hint="Pagamentos aprovados livres de estorno."
        emphasis
      />
      <Card
        label="A liberar"
        value={formatCents(pendingCents)}
        hint="Cobranças aguardando confirmação."
      />
      <Card label="Aprovado" value={formatCents(paidCents)} hint="Total recebido, antes de estornos." />
      <Card label="Estornado" value={formatCents(refundedCents)} hint="Devolvido aos clientes." />
    </div>
  );
}

function Card({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint: string;
  emphasis?: boolean;
}) {
  return (
    <article
      className={
        emphasis
          ? 'rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] p-4'
          : 'rounded-xl border border-[var(--color-border)] p-4'
      }
    >
      <p className="text-xs font-medium text-[var(--color-secondary)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-secondary)]">{hint}</p>
    </article>
  );
}
