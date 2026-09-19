'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createTimeOffAction, deleteTimeOffAction } from '@/lib/staffing/actions';
import { formatConflictDateTime } from '@/lib/staffing/format';
import type { StaffConflictView, TimeOffView } from '@/lib/staffing/types';
import { ConflictPanel } from './ConflictPanel';

/**
 * Bloqueios pontuais do profissional (tarefa F2.2): almoço extraordinário,
 * folga, emergência. Diferente do almoço recorrente — esse é jornada, não
 * bloqueio. Criar um bloqueio sobre agendamento existente devolve a lista de
 * conflitos e exige a decisão do dono.
 */
const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]';

export function TimeOffManager({
  staffId,
  initial,
  timezone,
}: {
  staffId: string;
  initial: TimeOffView[];
  timezone: string;
}) {
  const router = useRouter();
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [endsAtLocal, setEndsAtLocal] = useState('');
  const [reason, setReason] = useState('');
  const [conflicts, setConflicts] = useState<StaffConflictView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(confirm: boolean) {
    setError(null);
    if (!confirm) setConflicts(null);

    startTransition(async () => {
      const result = await createTimeOffAction(staffId, {
        startsAtLocal,
        endsAtLocal,
        reason,
        confirmConflicts: confirm,
      });
      if (result.ok) {
        setStartsAtLocal('');
        setEndsAtLocal('');
        setReason('');
        setConflicts(null);
        router.refresh();
        return;
      }
      if (result.code === 'CONFLICTS') {
        setConflicts(result.conflicts ?? []);
        return;
      }
      setError(result.message);
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteTimeOffAction(staffId, id);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-semibold">Bloqueios pontuais</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          Use para uma folga, um almoço fora do comum ou uma emergência.
        </p>
      </header>

      {initial.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {initial.map((timeOff) => (
            <li
              key={timeOff.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] p-3"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  {formatConflictDateTime(timeOff.startsAt, timezone)} —{' '}
                  {formatConflictDateTime(timeOff.endsAt, timezone)}
                </p>
                {timeOff.reason ? (
                  <p className="mt-0.5 text-xs text-[var(--color-secondary)]">{timeOff.reason}</p>
                ) : null}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleDelete(timeOff.id)}
                className="shrink-0 rounded-lg border border-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-[var(--color-secondary)]">Nenhum bloqueio ativo.</p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeoff-start" className="text-xs font-medium">
              Início
            </label>
            <input
              id="timeoff-start"
              type="datetime-local"
              value={startsAtLocal}
              onChange={(event) => setStartsAtLocal(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="timeoff-end" className="text-xs font-medium">
              Fim
            </label>
            <input
              id="timeoff-end"
              type="datetime-local"
              value={endsAtLocal}
              onChange={(event) => setEndsAtLocal(event.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="timeoff-reason" className="text-xs font-medium">
            Motivo
          </label>
          <input
            id="timeoff-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Ex.: consulta médica"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}

        {conflicts ? (
          <ConflictPanel
            conflicts={conflicts}
            timezone={timezone}
            pending={pending}
            confirmLabel="Criar mesmo assim"
            onConfirm={() => submit(true)}
            onCancel={() => setConflicts(null)}
          />
        ) : (
          <div>
            <button
              type="button"
              disabled={pending}
              onClick={() => submit(false)}
              className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {pending ? 'Criando…' : 'Criar bloqueio'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
