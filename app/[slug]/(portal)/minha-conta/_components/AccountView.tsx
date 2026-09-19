'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents, formatDuration } from '../../agendar/_lib/format';
import { cancelBookingAction, loadRescheduleSlotsAction, rescheduleBookingAction } from '../actions';
import type { AccountBooking, AccountData, AccountSlot } from '../_lib/types';

/**
 * Área do cliente (F3.4): próximos agendamentos, histórico, cancelar e remarcar.
 *
 * DECISÃO DE PRODUTO: fora da janela do tenant, o botão de cancelar NÃO some —
 * ele explica a política. Botão que desaparece parece defeito e o cliente liga
 * para o salão; um texto que explica devolve autonomia.
 *
 * O cliente nunca escolhe o próprio id: o servidor o deriva da sessão. Aqui só
 * circulam ids de agendamento, e o domínio reconfere a posse.
 */

const STATUS_LABEL: Record<AccountBooking['status'], string> = {
  HOLD: 'Reservado',
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function AccountView({ basePath, data }: { basePath: string; data: AccountData }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [policyFor, setPolicyFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [date, setDate] = useState(data.dates[0]?.date ?? '');
  const [slots, setSlots] = useState<AccountSlot[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [loadingSlots, startSlots] = useTransition();
  const [acting, startAct] = useTransition();

  function loadSlots(bookingId: string, targetDate: string) {
    setSlotsError(null);
    setSlots([]);
    startSlots(async () => {
      const result = await loadRescheduleSlotsAction({ bookingId, date: targetDate });
      if (result.ok) {
        setSlots(result.value);
        return;
      }
      setSlotsError(result.message);
    });
  }

  function handleCancel(booking: AccountBooking) {
    setNotice(null);
    if (!booking.canManage) {
      setPolicyFor(booking.id);
      return;
    }
    setPolicyFor(null);
    setPendingId(booking.id);
    startAct(async () => {
      const result = await cancelBookingAction({ bookingId: booking.id });
      setPendingId(null);
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.message });
        return;
      }
      setNotice({ kind: 'success', text: 'Agendamento cancelado.' });
      router.refresh();
    });
  }

  function openReschedule(booking: AccountBooking) {
    setNotice(null);
    if (!booking.canManage) {
      setPolicyFor(booking.id);
      return;
    }
    setPolicyFor(null);
    setRescheduleFor(booking.id);
    const first = data.dates[0]?.date ?? '';
    setDate(first);
    loadSlots(booking.id, first);
  }

  function chooseRescheduleSlot(booking: AccountBooking, slot: AccountSlot) {
    setNotice(null);
    setSlotsError(null);
    setPendingId(booking.id);
    startAct(async () => {
      const result = await rescheduleBookingAction({ bookingId: booking.id, startsAt: slot.value });
      setPendingId(null);
      if (!result.ok) {
        setSlotsError(result.message);
        return;
      }
      setNotice({ kind: 'success', text: 'Agendamento remarcado.' });
      setRescheduleFor(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Meus agendamentos</h1>
        <p className="text-sm text-[var(--color-secondary)]">
          Acompanhe e gerencie os seus horários.
        </p>
      </header>

      {notice ? (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${
            notice.kind === 'success'
              ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
              : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="proximos">
        <h2 id="proximos" className="text-base font-semibold">
          Próximos
        </h2>
        {data.upcoming.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Você não tem agendamentos futuros.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.upcoming.map((booking) => (
              <li key={booking.id}>
                <UpcomingCard
                  booking={booking}
                  cancellationWindowHours={data.cancellationWindowHours}
                  pending={pendingId === booking.id && acting}
                  policyVisible={policyFor === booking.id}
                  rescheduleOpen={rescheduleFor === booking.id}
                  slots={slots}
                  slotsError={slotsError}
                  slotsLoading={loadingSlots}
                  date={date}
                  dates={data.dates}
                  onCancel={() => handleCancel(booking)}
                  onToggleReschedule={() => openReschedule(booking)}
                  onChooseDate={(value) => {
                    setDate(value);
                    loadSlots(booking.id, value);
                  }}
                  onChooseSlot={(slot) => chooseRescheduleSlot(booking, slot)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="historico">
        <h2 id="historico" className="text-base font-semibold">
          Histórico
        </h2>
        {data.history.length === 0 ? (
          <p className="text-sm text-[var(--color-secondary)]">Nada por aqui ainda.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.history.map((booking) => (
              <li
                key={booking.id}
                className="rounded-xl border border-[var(--color-border)] p-4 text-sm opacity-80"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{booking.serviceName}</p>
                    <p className="text-[var(--color-secondary)]">{booking.startsAtLabel}</p>
                    <p className="text-[var(--color-secondary)]">com {booking.staffName}</p>
                  </div>
                  <StatusBadge status={booking.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <a
        href={basePath || '/'}
        className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-center text-sm font-semibold"
      >
        Voltar ao início
      </a>
    </div>
  );
}

function UpcomingCard({
  booking,
  cancellationWindowHours,
  pending,
  policyVisible,
  rescheduleOpen,
  slots,
  slotsError,
  slotsLoading,
  date,
  dates,
  onCancel,
  onToggleReschedule,
  onChooseDate,
  onChooseSlot,
}: {
  booking: AccountBooking;
  cancellationWindowHours: number;
  pending: boolean;
  policyVisible: boolean;
  rescheduleOpen: boolean;
  slots: AccountSlot[];
  slotsError: string | null;
  slotsLoading: boolean;
  date: string;
  dates: AccountData['dates'];
  onCancel: () => void;
  onToggleReschedule: () => void;
  onChooseDate: (value: string) => void;
  onChooseSlot: (slot: AccountSlot) => void;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{booking.serviceName}</p>
          <p className="text-sm text-[var(--color-secondary)]">{booking.startsAtLabel}</p>
          <p className="text-sm text-[var(--color-secondary)]">com {booking.staffName}</p>
          <p className="mt-1 text-xs text-[var(--color-secondary)]">
            {formatDuration(booking.durationMin)} · {formatCents(booking.priceCents)}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-[var(--color-danger)] px-3 py-2 text-sm font-medium text-[var(--color-danger)] disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onToggleReschedule}
          disabled={pending}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
        >
          Remarcar
        </button>
      </div>

      {policyVisible ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)]"
        >
          {policyText(cancellationWindowHours)}
        </p>
      ) : null}

      {rescheduleOpen ? (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
          <p className="text-sm font-medium">Escolha o novo horário</p>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {dates.map((day) => {
              const selected = day.date === date;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => onChooseDate(day.date)}
                  aria-pressed={selected}
                  className={`flex min-w-16 flex-col items-center rounded-xl border px-3 py-2 text-sm ${
                    selected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  <span className="text-xs capitalize">{day.weekday}</span>
                  <span className="font-semibold">{day.dayMonth}</span>
                </button>
              );
            })}
          </div>

          {slotsError ? (
            <p
              role="alert"
              className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {slotsError}
            </p>
          ) : null}

          {slotsLoading ? (
            <p className="text-sm text-[var(--color-secondary)]">Carregando horários…</p>
          ) : slots.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-secondary)]">
              Nenhum horário livre neste dia.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <li key={slot.value}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onChooseSlot(slot)}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium disabled:opacity-60"
                  >
                    {slot.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </article>
  );
}

function StatusBadge({ status }: { status: AccountBooking['status'] }) {
  const success = status === 'CONFIRMED' || status === 'COMPLETED';
  const danger = status === 'CANCELLED' || status === 'NO_SHOW';
  const cls = success
    ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
    : danger
      ? 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]'
      : 'bg-[var(--color-muted)] text-[var(--color-secondary)]';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function policyText(hours: number): string {
  if (hours <= 0) {
    return 'O estabelecimento não permite cancelamento ou remarcação online. Fale diretamente com ele.';
  }
  const plural = hours === 1 ? 'hora' : 'horas';
  return `O estabelecimento aceita cancelamento e remarcação até ${hours} ${plural} antes do horário. Para este agendamento, esse prazo já passou — fale diretamente com o estabelecimento.`;
}
