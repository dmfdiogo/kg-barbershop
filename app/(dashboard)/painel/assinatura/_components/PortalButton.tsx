'use client';

import { useState, useTransition } from 'react';
import { openPortalAction } from '../actions';

/**
 * Abre o portal hospedado: trocar cartão e ver faturas (tarefa F8.0-B).
 *
 * O portal não oferece troca de plano nem cancelamento — esses dois passam
 * pelas server actions desta tela, porque o downgrade tem regra nossa
 * (`lib/billing/limits.ts`). Quem configura o portal no provedor deve manter
 * essas opções desligadas (item da F8.1).
 */
interface PortalButtonProps {
  label: string;
  variant?: 'primary' | 'outline';
}

export function PortalButton({ label, variant = 'outline' }: PortalButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await openPortalAction();
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      setError(result.message);
    });
  }

  const className =
    variant === 'primary'
      ? 'rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60'
      : 'rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60';

  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={handleClick} disabled={pending} className={className}>
        {pending ? 'Abrindo…' : label}
      </button>
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
