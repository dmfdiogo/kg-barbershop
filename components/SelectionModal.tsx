'use client';

import type { ReactNode } from 'react';
import { CloseIcon } from '@/components/icons';

interface SelectionModalProps<T> {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: T[];
  onSelect: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  keyExtractor: (item: T) => string | number;
}

export default function SelectionModal<T>({
  isOpen,
  onClose,
  title,
  items,
  onSelect,
  renderItem,
  keyExtractor,
}: SelectionModalProps<T>) {
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
        aria-label={title}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-border bg-background shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="w-8" aria-hidden="true" />
          <h3 className="text-xl font-bold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-secondary transition-colors hover:text-foreground"
            aria-label="Fechar"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-4">
          {items.length === 0 ? (
            <p className="py-4 text-center text-secondary">Nenhum item disponível.</p>
          ) : (
            items.map((item) => (
              <div
                key={keyExtractor(item)}
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
                className="cursor-pointer"
              >
                {renderItem(item)}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
