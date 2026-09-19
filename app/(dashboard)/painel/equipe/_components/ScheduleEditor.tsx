'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveWeeklyScheduleAction } from '@/lib/staffing/actions';
import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  type StaffConflictView,
  type WorkingHoursView,
} from '@/lib/staffing/types';
import { ConflictPanel } from './ConflictPanel';

/**
 * Jornada semanal por profissional (tarefa F2.2).
 *
 * O modelo é o do seed: cada dia tem uma lista de faixas, e o intervalo de
 * almoço é a AUSÊNCIA de jornada entre duas faixas (10:00–12:00 e
 * 13:00–19:00), nunca um bloqueio. Dia sem faixa é folga. Ao salvar, a server
 * action devolve a lista de agendamentos que ficariam descobertos e exige a
 * confirmação do dono — nada é apagado sem essa decisão.
 */

const INPUT_CLASS =
  'rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-primary)]';

interface RangeState {
  start: string;
  end: string;
}

type ScheduleState = Record<number, RangeState[]>;

function buildState(initial: WorkingHoursView[]): ScheduleState {
  const state: ScheduleState = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const hours of initial) {
    state[hours.weekday]?.push({ start: hours.startTime, end: hours.endTime });
  }
  return state;
}

function rangesOf(state: ScheduleState, weekday: number): RangeState[] {
  return state[weekday] ?? [];
}

function toPayload(state: ScheduleState) {
  return WEEKDAYS.map((weekday) => ({
    weekday,
    ranges: rangesOf(state, weekday)
      .filter((range) => range.start.length > 0 && range.end.length > 0)
      .map((range) => ({ start: range.start, end: range.end })),
  }));
}

export function ScheduleEditor({
  staffId,
  initial,
  timezone,
}: {
  staffId: string;
  initial: WorkingHoursView[];
  timezone: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ScheduleState>(() => buildState(initial));
  const [conflicts, setConflicts] = useState<StaffConflictView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateRange(weekday: number, index: number, patch: Partial<RangeState>) {
    setState((current) => {
      const ranges = rangesOf(current, weekday).map((range, i) =>
        i === index ? { ...range, ...patch } : range,
      );
      return { ...current, [weekday]: ranges };
    });
  }

  function addRange(weekday: number) {
    setState((current) => {
      const ranges = rangesOf(current, weekday);
      const previous = ranges[ranges.length - 1];
      const next: RangeState = previous
        ? { start: previous.end, end: previous.end === '12:00' ? '18:00' : previous.end }
        : { start: '09:00', end: '18:00' };
      return { ...current, [weekday]: [...ranges, next] };
    });
  }

  function removeRange(weekday: number, index: number) {
    setState((current) => ({
      ...current,
      [weekday]: rangesOf(current, weekday).filter((_, i) => i !== index),
    }));
  }

  function submit(confirm: boolean) {
    setError(null);
    if (!confirm) setConflicts(null);
    const schedule = toPayload(state);

    startTransition(async () => {
      const result = await saveWeeklyScheduleAction(staffId, {
        schedule,
        confirmConflicts: confirm,
      });
      if (result.ok) {
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

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-semibold">Jornada semanal</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          Duas faixas no mesmo dia criam o intervalo de almoço. Dia sem faixa é folga.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        {WEEKDAYS.map((weekday) => {
          const ranges = rangesOf(state, weekday);
          const dayLabel = WEEKDAY_LABELS[weekday] ?? String(weekday);
          return (
            <div
              key={weekday}
              className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3 sm:flex-row sm:items-start"
            >
              <p className="w-20 shrink-0 pt-1.5 text-sm font-medium">{dayLabel}</p>

              <div className="flex flex-1 flex-col gap-2">
                {ranges.length === 0 ? (
                  <p className="pt-1.5 text-xs text-[var(--color-secondary)]">Folga</p>
                ) : null}

                {ranges.map((range, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="time"
                      value={range.start}
                      onChange={(event) => updateRange(weekday, index, { start: event.target.value })}
                      className={INPUT_CLASS}
                      aria-label={`${dayLabel} início ${index + 1}`}
                    />
                    <span className="text-xs text-[var(--color-secondary)]">até</span>
                    <input
                      type="time"
                      value={range.end}
                      onChange={(event) => updateRange(weekday, index, { end: event.target.value })}
                      className={INPUT_CLASS}
                      aria-label={`${dayLabel} fim ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeRange(weekday, index)}
                      className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
                    >
                      Remover
                    </button>
                  </div>
                ))}

                <div>
                  <button
                    type="button"
                    onClick={() => addRange(weekday)}
                    className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                  >
                    + faixa
                  </button>
                </div>
              </div>
            </div>
          );
        })}
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
          confirmLabel="Salvar mesmo assim"
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
            {pending ? 'Salvando…' : 'Salvar jornada'}
          </button>
        </div>
      )}
    </section>
  );
}
