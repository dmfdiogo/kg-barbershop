'use client';

import { useState, useTransition } from 'react';
import { parseMoneyToCents } from '@/lib/catalog/money';
import { formatCents } from '@/lib/money';
import { refundPaymentAction } from '../actions';

/**
 * Estorno pelo painel (tarefa F4.3).
 *
 * O valor só vira centavos inteiros (`parseMoneyToCents`) e nunca passa por
 * float — a diferença de um centavo no estorno é o bug que ninguém explica
 * depois. `maxRefundableCents` é o teto calculado no servidor pela política de
 * cancelamento do tenant; o cliente só o exibe, a decisão é revalidada na action.
 */

export function RefundButton({
  paymentId,
  maxRefundableCents,
}: {
  paymentId: string;
  maxRefundableCents: number;
}) {
  const [pending, startTransition] = useTransition();
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function submit(amountCents: number | null) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await refundPaymentAction(paymentId, amountCents);
      if (result.ok) {
        setDone(`Estorno de ${formatCents(result.amountCents)} enviado ao provedor.`);
        setPartial(false);
        setAmount('');
      } else {
        setError(result.message);
      }
    });
  }

  function submitPartial() {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents <= 0) {
      setError('Informe um valor válido, em reais.');
      return;
    }
    if (cents > maxRefundableCents) {
      setError(`O máximo para este pagamento é ${formatCents(maxRefundableCents)}.`);
      return;
    }
    submit(cents);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => submit(null)}
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
        >
          {pending ? 'Estornando…' : `Estornar ${formatCents(maxRefundableCents)}`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setPartial((value) => !value)}
          className="text-xs text-[var(--color-secondary)] underline-offset-2 hover:underline disabled:opacity-60"
        >
          Estorno parcial
        </button>
      </div>

      {partial ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-[var(--color-secondary)]" htmlFor={`refund-${paymentId}`}>
            Valor
          </label>
          <input
            id={`refund-${paymentId}`}
            name="amountCents"
            inputMode="decimal"
            placeholder="0,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="w-28 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={pending}
            onClick={submitPartial}
            className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-background)] disabled:opacity-60"
          >
            Confirmar
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-xs text-[var(--color-success)]">
          {done}
        </p>
      ) : null}
    </div>
  );
}
