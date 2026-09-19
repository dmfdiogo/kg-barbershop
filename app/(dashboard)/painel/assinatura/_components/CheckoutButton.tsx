'use client';

import { useState, useTransition } from 'react';
import type { BillingPlanCode } from '@/lib/billing/plans';
import { startCheckoutAction } from '../actions';

/**
 * Botão de assinar (tarefa F8.0-B).
 *
 * Não coleta cartão: chama a server action, recebe a URL ABSOLUTA do Checkout
 * hospedado e redireciona. O cartão é digitado na página do provedor — PCI fica
 * do outro lado, como manda `lib/billing/types.ts`.
 */
interface CheckoutButtonProps {
  plan: BillingPlanCode;
  label: string;
}

export function CheckoutButton({ plan, label }: CheckoutButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await startCheckoutAction(plan);
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Abrindo pagamento…' : label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
