'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatInTimeZone } from 'date-fns-tz';
import CalendarView, {
  type CalendarAppointment,
  type CalendarViewMode,
} from '@/components/CalendarView';
import { formatCentsToBRL } from '@/lib/catalog/money';
import { markCompletedAction, markNoShowAction } from '../actions';
import type { AgendaBookingView, AgendaDisplayStatus } from '../_lib/types';

/**
 * Quadro da agenda (tarefa F3.5): reusa o `CalendarView` da F0.4 (grade semanal
 * ou lista do dia) e abre o atendimento selecionado com as ações de finalizar e
 * não compareceu. O status exibido é derivado: "Pago" combina `CONFIRMED` com
 * um pagamento aprovado.
 */

const DISPLAY_LABEL: Record<AgendaDisplayStatus, string> = {
  CONFIRMED: 'Confirmado',
  PAID: 'Pago',
  PENDING: 'Pendente',
  COMPLETED: 'Finalizado',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
};

const STATUS_TONE: Record<AgendaDisplayStatus, string> = {
  CONFIRMED: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  PAID: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  PENDING: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  COMPLETED: 'bg-[var(--color-secondary-soft)] text-[var(--color-secondary)]',
  CANCELLED: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  NO_SHOW: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
};

export interface AgendaBoardProps {
  bookings: AgendaBookingView[];
  timezone: string;
  date: string;
  view: CalendarViewMode;
}

export function AgendaBoard({ bookings, timezone, date, view }: AgendaBoardProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = selectedId
    ? bookings.find((booking) => booking.id === selectedId) ?? null
    : null;

  function run(action: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await action(selected.id);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSelectedId(null);
      router.refresh();
    });
  }

  const appointments: CalendarAppointment[] = bookings.map((booking) => ({
    id: booking.id,
    status: booking.status,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    customer: { name: booking.customerName },
    service: { name: booking.serviceName, durationMin: 0 },
  }));

  return (
    <div className="flex flex-col gap-4">
      <CalendarView
        appointments={appointments}
        onSelectEvent={(appointment) => setSelectedId(String(appointment.id))}
        timezone={timezone}
        referenceDate={new Date(`${date}T12:00:00`)}
        view={view}
      />

      {selected ? (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">{selected.customerName}</p>
              <p className="mt-0.5 text-xs text-[var(--color-secondary)]">
                {formatInTimeZone(new Date(selected.startsAt), timezone, 'dd/MM HH:mm')} ·{' '}
                {selected.serviceName}
                {selected.staffName ? ` · ${selected.staffName}` : ''}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-secondary)]">
                {formatCentsToBRL(selected.priceCents)}
                {selected.source === 'WALK_IN' ? ' · walk-in' : ''}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_TONE[selected.displayStatus]}`}
            >
              {DISPLAY_LABEL[selected.displayStatus]}
            </span>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
              {error}
            </p>
          ) : null}

          {selected.status === 'CONFIRMED' ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markCompletedAction)}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                Finalizar
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markNoShowAction)}
                className="rounded-lg border border-[var(--color-danger)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
              >
                Não compareceu
              </button>
            </div>
          ) : selected.status === 'PENDING' || selected.status === 'HOLD' ? (
            <div className="mt-4">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(markNoShowAction)}
                className="rounded-lg border border-[var(--color-danger)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
              >
                Não compareceu
              </button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-[var(--color-secondary)]">
              Este atendimento já está encerrado.
            </p>
          )}
        </section>
      ) : (
        <p className="text-xs text-[var(--color-secondary)]">
          Toque em um atendimento para ver os detalhes e as ações.
        </p>
      )}
    </div>
  );
}
