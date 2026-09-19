'use client';

import { useMemo } from 'react';
import { eachDayOfInterval, endOfWeek, format, isSameDay, startOfWeek } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { formatInTimeZone } from 'date-fns-tz';

export interface CalendarAppointment {
  id: string | number;
  status: string;
  startsAt: Date | string;
  endsAt?: Date | string;
  customer: { name: string };
  service: { name: string; durationMin: number };
}

/**
 * `week` desenha a grade de sete colunas da F0.4; `day` lista os atendimentos
 * do dia de referência em ordem de horário (mobile-first). A visão de dia foi
 * acrescentada pela F3.5 estendendo este componente, sem reintroduzir
 * `react-big-calendar`.
 */
export type CalendarViewMode = 'week' | 'day';

interface CalendarViewProps {
  appointments: CalendarAppointment[];
  onSelectEvent: (appointment: CalendarAppointment) => void;
  /** Fuso do tenant (`Tenant.timezone`). */
  timezone: string;
  /** Dia/semana exibida; padrão é hoje. */
  referenceDate?: Date;
  /** Modo de exibição; padrão `week` (contrato original da F0.4). */
  view?: CalendarViewMode;
}

function statusClasses(status: string): string {
  switch (status) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return 'bg-success-soft text-success';
    case 'PENDING':
    case 'HOLD':
      return 'bg-warning-soft text-warning';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'bg-danger-soft text-danger line-through';
    default:
      return 'bg-secondary/20 text-foreground';
  }
}

export default function CalendarView({
  appointments,
  onSelectEvent,
  timezone,
  referenceDate,
  view = 'week',
}: CalendarViewProps) {
  const weekDays = useMemo(() => {
    const reference = referenceDate ?? new Date();

    return eachDayOfInterval({
      start: startOfWeek(reference, { weekStartsOn: 0 }),
      end: endOfWeek(reference, { weekStartsOn: 0 }),
    });
  }, [referenceDate]);

  const appointmentsByDay = useMemo(() => {
    const grouped = new Map<string, CalendarAppointment[]>();

    for (const appointment of appointments) {
      const startsAt = new Date(appointment.startsAt);
      if (Number.isNaN(startsAt.getTime())) continue;

      // O agrupamento é pelo dia local do tenant — um atendimento das 22h de
      // Brasília pertence ao dia 18, ainda que em UTC seja 01h do dia 19.
      const dayKey = formatInTimeZone(startsAt, timezone, 'yyyy-MM-dd');
      const dayAppointments = grouped.get(dayKey) ?? [];
      dayAppointments.push(appointment);
      grouped.set(dayKey, dayAppointments);
    }

    for (const dayAppointments of grouped.values()) {
      dayAppointments.sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
    }

    return grouped;
  }, [appointments, timezone]);

  const today = new Date();
  const reference = referenceDate ?? today;

  // Visão de dia: lista vertical do dia local do tenant, em ordem de horário.
  if (view === 'day') {
    const dayKey = formatInTimeZone(reference, timezone, 'yyyy-MM-dd');
    const dayAppointments = appointmentsByDay.get(dayKey) ?? [];

    return (
      <div className="rounded-xl border border-border bg-background p-4">
        <p className="mb-3 text-sm font-bold capitalize text-foreground">
          {formatInTimeZone(reference, timezone, 'EEEE, dd/MM', { locale: ptBR })}
        </p>

        {dayAppointments.length === 0 ? (
          <p className="py-6 text-center text-xs text-secondary/60">
            Nenhum atendimento neste dia.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayAppointments.map((appointment) => (
              <li key={appointment.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(appointment)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${statusClasses(appointment.status)}`}
                >
                  <span className="w-12 shrink-0 font-bold">
                    {formatInTimeZone(new Date(appointment.startsAt), timezone, 'HH:mm')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{appointment.customer.name}</span>
                    <span className="block truncate text-xs opacity-80">
                      {appointment.service.name}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-background p-4">
      <div className="grid min-w-[640px] grid-cols-7 gap-2">
        {weekDays.map((day) => {
          const dayKey = format(day, 'yyyy-MM-dd');
          const dayAppointments = appointmentsByDay.get(dayKey) ?? [];
          const isToday = isSameDay(day, today);

          return (
            <div
              key={dayKey}
              className={`rounded-lg border p-2 ${isToday ? 'border-primary' : 'border-border'}`}
            >
              <div className="mb-2 text-center">
                <p className="text-xs font-bold uppercase text-secondary">
                  {format(day, 'EEE', { locale: ptBR })}
                </p>
                <p className="text-sm font-bold text-foreground">{format(day, 'dd/MM')}</p>
              </div>

              <div className="space-y-2">
                {dayAppointments.length === 0 ? (
                  <p className="text-center text-xs text-secondary/60">—</p>
                ) : (
                  dayAppointments.map((appointment) => (
                    <button
                      key={appointment.id}
                      type="button"
                      onClick={() => onSelectEvent(appointment)}
                      className={`w-full rounded-md px-2 py-1 text-left text-xs ${statusClasses(appointment.status)}`}
                    >
                      <span className="block font-bold">
                        {formatInTimeZone(new Date(appointment.startsAt), timezone, 'HH:mm')}
                      </span>
                      <span className="block truncate">{appointment.customer.name}</span>
                      <span className="block truncate opacity-80">{appointment.service.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
