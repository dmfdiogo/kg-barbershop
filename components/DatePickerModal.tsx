'use client';

import { useMemo, useState } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/icons';

interface DatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Recebe a data escolhida no formato "YYYY-MM-DD". */
  onSelect: (date: string) => void;
  selectedDate?: string;
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export default function DatePickerModal({ isOpen, onClose, onSelect, selectedDate }: DatePickerModalProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  if (!isOpen) return null;

  const selected = selectedDate ? parseISO(selectedDate) : null;
  const days = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }),
    end: endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 }),
  });

  const handleDateClick = (day: Date) => {
    if (isBefore(day, today)) return;

    onSelect(format(day, 'yyyy-MM-dd'));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm backdrop-brightness-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Selecionar data"
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <button
            type="button"
            onClick={() => setCurrentMonth((month) => subMonths(month, 1))}
            className="rounded-full p-1 text-foreground transition-colors hover:bg-muted"
            aria-label="Mês anterior"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <h3 className="text-lg font-bold capitalize text-foreground">
            {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
          </h3>
          <button
            type="button"
            onClick={() => setCurrentMonth((month) => addMonths(month, 1))}
            className="rounded-full p-1 text-foreground transition-colors hover:bg-muted"
            aria-label="Próximo mês"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <div className="mb-2 grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((label, index) => (
              <div key={index} className="flex h-10 items-center justify-center text-xs font-bold text-secondary">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1 place-items-center">
            {days.map((day) => {
              if (!isSameMonth(day, currentMonth)) {
                return <div key={day.toISOString()} className="h-10 w-10" aria-hidden="true" />;
              }

              const isPast = isBefore(day, today);
              const isSelected = selected !== null && isValid(selected) && isSameDay(day, selected);
              const isToday = isSameDay(day, today);

              const stateClasses = isSelected
                ? 'bg-primary font-bold text-background'
                : isPast
                  ? 'cursor-not-allowed text-secondary/60'
                  : isToday
                    ? 'border border-primary text-primary hover:bg-muted'
                    : 'text-foreground hover:bg-muted';

              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => handleDateClick(day)}
                  disabled={isPast}
                  aria-label={format(day, "d 'de' MMMM 'de' yyyy", { locale: ptBR })}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium transition-colors ${stateClasses}`}
                >
                  {format(day, 'd')}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1 text-sm text-secondary transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
