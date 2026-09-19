'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Recarrega os dados do servidor (tarefa F8.0-B).
 *
 * Usado no estado "aguardando confirmação": o webhook do provedor pode ainda
 * não ter chegado quando o dono volta do Checkout, e este botão relê o estado
 * sem exigir recarregar o navegador.
 */
export function RefreshButton({ label = 'Atualizar' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleClick() {
    setFeedback(null);
    startTransition(() => {
      router.refresh();
      setFeedback('Estado atualizado.');
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
      >
        {pending ? 'Atualizando…' : label}
      </button>
      {feedback ? (
        <p role="status" className="text-xs text-[var(--color-secondary)]">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
