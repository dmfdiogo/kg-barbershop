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

interface CalendarViewProps {
  appointments: CalendarAppointment[];
  onSelectEvent: (appointment: CalendarAppointment) => void;
  /** Fuso do tenant (`Tenant.timezone`). */
  timezone: string;
  /** Semana exibida; padrão é a semana de hoje. */
  referenceDate?: Date;
}

function statusClasses(status: string): string {
  switch (status) {
    case 'CONFIRMED':
    case 'COMPLETED':
      return 'bg-primary text-background';
    case 'PENDING':
    case 'HOLD':
      return 'border border-primary bg-background text-foreground';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'bg-muted text-secondary line-through';
    default:
      return 'bg-secondary/20 text-foreground';
  }
}

export default function CalendarView({
  appointments,
  onSelectEvent,
  timezone,
  referenceDate,
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
