'use client';

import { formatInTimeZone } from 'date-fns-tz';
import { CloseIcon, ClockIcon } from '@/components/icons';

interface TimePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (time: string) => void;
  /** Slots em ISO 8601 UTC, como devolvidos por `getAvailability`. */
  slots: string[];
  selectedSlot: string | null;
  /** Fuso do tenant (`Tenant.timezone`) — a apresentação é sempre local a ele. */
  timezone: string;
}

export default function TimePickerModal({
  isOpen,
  onClose,
  onSelect,
  slots,
  selectedSlot,
  timezone,
}: TimePickerModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm backdrop-brightness-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Selecionar horário"
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="text-xl font-bold text-foreground">Selecione o Horário</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-secondary transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {slots.length === 0 ? (
            <div className="py-8 text-center text-secondary">
              <ClockIcon className="mx-auto mb-2 h-9 w-9 opacity-50" />
              <p>Nenhum horário disponível para esta data.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => {
                    onSelect(slot);
                    onClose();
                  }}
                  className={`rounded-lg px-2 py-3 text-sm font-medium transition-colors ${
                    selectedSlot === slot
                      ? 'bg-primary font-bold text-background shadow-lg shadow-primary/20'
                      : 'bg-muted text-secondary hover:text-foreground'
                  }`}
                >
                  {formatInTimeZone(new Date(slot), timezone, 'HH:mm')}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
