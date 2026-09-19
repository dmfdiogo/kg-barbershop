'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelSubscriptionAction } from '../actions';

/**
 * Cancelamento da assinatura (tarefa F8.0-B).
 *
 * Duas escolhas, com confirmação:
 *   - ao fim do período (padrão): o acesso continua até a data já paga;
 *   - imediatamente: novos agendamentos passam a ser bloqueados agora.
 *
 * Em nenhum dos casos algo existente é apagado — é a mesma regra de suspensão
 * graciosa do trial (`lib/billing/trial.ts`): bloqueia o novo, preserva o que
 * já existe.
 */
interface CancelSubscriptionPanelProps {
  timezone: string;
}

type CancelMode = 'PERIOD_END' | 'IMMEDIATE';

function formatDate(instant: string, timezone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);
}

export function CancelSubscriptionPanel({ timezone }: CancelSubscriptionPanelProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CancelMode>('PERIOD_END');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await cancelSubscriptionAction(mode === 'PERIOD_END');
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setDone(
        mode === 'PERIOD_END'
          ? `Cancelamento agendado para o fim do período${
              result.currentPeriodEnd
                ? ` (${formatDate(result.currentPeriodEnd, timezone)})`
                : ''
            }. A assinatura segue ativa até lá.`
          : 'Assinatura cancelada. Novos agendamentos ficam bloqueados; os já marcados continuam.',
      );
      router.refresh();
    });
  }

  if (done) {
    return (
      <section className="rounded-xl border border-[var(--color-border)] p-4">
        <p role="status" className="text-sm text-[var(--color-secondary)]">
          {done}
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <div>
        <h2 className="text-sm font-semibold">Cancelar assinatura</h2>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Nada do que já existe é apagado. Você deixa de receber agendamentos novos a
          partir do cancelamento.
        </p>
      </div>

      {!open ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-lg border border-[var(--color-danger)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)]"
          >
            Quero cancelar
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium">Quando o cancelamento vale</legend>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="cancel-mode"
                checked={mode === 'PERIOD_END'}
                onChange={() => setMode('PERIOD_END')}
                className="mt-0.5"
              />
              <span>
                Ao fim do período
                <span className="block text-xs text-[var(--color-secondary)]">
                  Você continua com acesso até a data já paga.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="cancel-mode"
                checked={mode === 'IMMEDIATE'}
                onChange={() => setMode('IMMEDIATE')}
                className="mt-0.5"
              />
              <span>
                Imediatamente
                <span className="block text-xs text-[var(--color-secondary)]">
                  Novos agendamentos são bloqueados agora; os existentes continuam.
                </span>
              </span>
            </label>
          </fieldset>

          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={confirm}
              disabled={pending}
              className="rounded-lg bg-[var(--color-danger)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
            >
              Voltar
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
