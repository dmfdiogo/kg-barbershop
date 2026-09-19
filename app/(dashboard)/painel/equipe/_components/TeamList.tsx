'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/dashboard/states';
import { setStaffActiveAction } from '@/lib/staffing/actions';
import { WEEKDAY_LABELS, type StaffMemberView } from '@/lib/staffing/types';

/**
 * Lista da equipe (tarefa F2.2). A jornada é resumida por dia com faixas
 * (ex.: "Ter 10:00–12:00, 13:00–19:00") e dia sem faixa aparece como folga —
 * o modelo que o seed de Bruna (almoço) e Tiago (folga) expressa.
 */
function scheduleSummary(member: StaffMemberView): string {
  if (member.workingHours.length === 0) return 'Sem jornada definida.';

  const byWeekday = new Map<number, string[]>();
  for (const hours of member.workingHours) {
    const list = byWeekday.get(hours.weekday) ?? [];
    list.push(`${hours.startTime}–${hours.endTime}`);
    byWeekday.set(hours.weekday, list);
  }

  return [...byWeekday.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekday, ranges]) => `${WEEKDAY_LABELS[weekday] ?? weekday} ${ranges.join(', ')}`)
    .join(' · ');
}

export function TeamList({ members }: { members: StaffMemberView[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(member: StaffMemberView) {
    setError(null);
    setPendingId(member.id);
    startTransition(async () => {
      const result = await setStaffActiveAction(member.id, !member.active);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="Nenhum profissional na equipe"
        description="Convide por telefone para definir jornada e serviços."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {members.map((member) => {
        const pending = pendingId === member.id;
        return (
          <article
            key={member.id}
            className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{member.name}</p>
                <p className="mt-0.5 text-xs text-[var(--color-secondary)]">{member.phone}</p>
              </div>
              <span
                className={
                  member.active
                    ? 'shrink-0 rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]'
                    : 'shrink-0 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-secondary)]'
                }
              >
                {member.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <p className="text-xs text-[var(--color-secondary)]">{scheduleSummary(member)}</p>
            <p className="text-xs text-[var(--color-secondary)]">
              {member.serviceIds.length === 0
                ? 'Nenhum serviço vinculado.'
                : `${member.serviceIds.length} serviço(s) vinculado(s).`}
            </p>

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/painel/equipe/${member.id}` as Route}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
              >
                Editar jornada
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleToggle(member)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
              >
                {member.active ? 'Desativar' : 'Ativar'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
