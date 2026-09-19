'use client';

import type { StaffConflictView } from '@/lib/staffing/types';
import { formatConflictDateTime } from '@/lib/staffing/format';

/**
 * Lista de conflitos e decisão explícita do dono (tarefa F2.2).
 *
 * É a peça de UI da regra central: reduzir jornada ou criar bloqueio não pode
 * apagar agendamento em silêncio. O painel mostra QUAIS agendamentos ficariam
 * descobertos e só libera a gravação com um clique consciente. Nada foi alterado
 * no banco até aqui — a recusa veio da server action antes de qualquer escrita.
 */
export function ConflictPanel({
  conflicts,
  timezone,
  pending,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  conflicts: StaffConflictView[];
  timezone: string;
  pending: boolean;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg bg-[var(--color-warning-soft)] p-4"
    >
      <p className="text-sm font-semibold text-[var(--color-warning)]">
        {conflicts.length === 1
          ? '1 agendamento fica fora deste horário:'
          : `${conflicts.length} agendamentos ficam fora deste horário:`}
      </p>

      <ul className="flex flex-col gap-1.5">
        {conflicts.map((conflict) => (
          <li key={conflict.bookingId} className="text-xs text-[var(--color-warning)]">
            <span className="font-medium">
              {formatConflictDateTime(conflict.startsAt, timezone)}
            </span>{' '}
            · {conflict.customerName} · {conflict.serviceName}
          </li>
        ))}
      </ul>

      <p className="text-xs text-[var(--color-warning)]">
        Nenhum agendamento foi apagado. Confirme para salvar mesmo assim.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="rounded-lg bg-[var(--color-warning)] px-3 py-2 text-xs font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : confirmLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
