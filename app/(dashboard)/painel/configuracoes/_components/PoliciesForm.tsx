'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { savePoliciesAction } from '../actions';
import type { PoliciesField, TenantPoliciesValue } from '../validation';

/**
 * Formulário das políticas de agenda (tarefa F2.4). Só coleta e exibe: a
 * validação e a conversão de tipos acontecem na server action.
 */

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]';

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[var(--color-secondary)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function minutesToDaysLabel(minutes: string): string | null {
  if (minutes.trim().length === 0) return null;
  const value = Number(minutes);
  if (!Number.isInteger(value) || value < 0) return null;
  if (value % (60 * 24) === 0) {
    const days = value / (60 * 24);
    return days === 0 ? 'Sem antecedência' : `${days} dia${days === 1 ? '' : 's'}`;
  }
  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours} hora${hours === 1 ? '' : 's'}`;
  }
  return `${value} minuto${value === 1 ? '' : 's'}`;
}

export function PoliciesForm({ initial }: { initial: TenantPoliciesValue }) {
  const router = useRouter();
  const [cancellationWindowHours, setCancellationWindowHours] = useState(
    String(initial.cancellationWindowHours),
  );
  const [minAdvanceMinutes, setMinAdvanceMinutes] = useState(String(initial.minAdvanceMinutes));
  const [maxAdvanceMinutes, setMaxAdvanceMinutes] = useState(
    initial.maxAdvanceMinutes === null ? '' : String(initial.maxAdvanceMinutes),
  );
  const [noShowPolicyText, setNoShowPolicyText] = useState(initial.noShowPolicyText ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PoliciesField, string>>>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setFieldErrors({});

    startTransition(async () => {
      const result = await savePoliciesAction({
        cancellationWindowHours,
        minAdvanceMinutes,
        maxAdvanceMinutes,
        noShowPolicyText,
      });

      if (result.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      setError(result.message);
      if (result.code === 'INVALID') setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-[var(--color-border)] p-5"
      noValidate
    >
      <div>
        <h2 className="text-base font-semibold">Políticas da agenda</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          Valem para o agendamento e o cancelamento feitos pelo portal do cliente.
        </p>
      </div>

      <Field
        label="Janela de cancelamento (horas)"
        htmlFor="cancellationWindowHours"
        error={fieldErrors.cancellationWindowHours}
        hint="O cliente só pode cancelar/remarcar até este número de horas antes do atendimento."
      >
        <input
          id="cancellationWindowHours"
          name="cancellationWindowHours"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={cancellationWindowHours}
          onChange={(event) => setCancellationWindowHours(event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <Field
        label="Antecedência mínima para agendar (minutos)"
        htmlFor="minAdvanceMinutes"
        error={fieldErrors.minAdvanceMinutes}
        hint={minutesToDaysLabel(minAdvanceMinutes) ?? 'Quanto antes do horário o cliente pode agendar.'}
      >
        <input
          id="minAdvanceMinutes"
          name="minAdvanceMinutes"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={minAdvanceMinutes}
          onChange={(event) => setMinAdvanceMinutes(event.target.value)}
          className={INPUT_CLASS}
        />
      </Field>

      <Field
        label="Antecedência máxima para agendar (minutos)"
        htmlFor="maxAdvanceMinutes"
        error={fieldErrors.maxAdvanceMinutes}
        hint={
          minutesToDaysLabel(maxAdvanceMinutes) ??
          'Deixe em branco para não limitar a distância da agenda.'
        }
      >
        <input
          id="maxAdvanceMinutes"
          name="maxAdvanceMinutes"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={maxAdvanceMinutes}
          onChange={(event) => setMaxAdvanceMinutes(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Sem limite"
        />
      </Field>

      <Field
        label="Política de no-show"
        htmlFor="noShowPolicyText"
        error={fieldErrors.noShowPolicyText}
        hint="Texto exibido ao cliente no portal. Sem semântica automática."
      >
        <textarea
          id="noShowPolicyText"
          name="noShowPolicyText"
          rows={3}
          value={noShowPolicyText}
          onChange={(event) => setNoShowPolicyText(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Ex.: Faltas sem aviso podem reter o sinal pago."
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : 'Salvar políticas'}
        </button>
        {saved ? (
          <span role="status" className="text-sm text-[var(--color-success)]">
            Políticas atualizadas.
          </span>
        ) : null}
      </div>

      {error && !Object.keys(fieldErrors).length ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
