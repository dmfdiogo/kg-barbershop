'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveStaffServicesAction } from '@/lib/staffing/actions';

/**
 * Vínculo profissional × serviços (tarefa F2.2). Define o que a grade do
 * profissional oferece; serviço desativado continua vinculável, mas sai do
 * catálogo público.
 */
export interface ServiceOption {
  id: string;
  name: string;
  active: boolean;
}

export function StaffServicesForm({
  staffId,
  services,
  initialServiceIds,
}: {
  staffId: string;
  services: ServiceOption[];
  initialServiceIds: string[];
}) {
  const router = useRouter();
  const [serviceIds, setServiceIds] = useState<string[]>(initialServiceIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setServiceIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await saveStaffServicesAction(staffId, { serviceIds });
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <header>
        <h2 className="text-sm font-semibold">Serviços habilitados</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          Marque o que este profissional pode atender.
        </p>
      </header>

      {services.length === 0 ? (
        <p className="text-xs text-[var(--color-secondary)]">
          Nenhum serviço cadastrado. Crie serviços em Catálogo.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] p-3">
          {services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={serviceIds.includes(service.id)}
                onChange={() => toggle(service.id)}
              />
              <span>{service.name}</span>
              {!service.active ? (
                <span className="text-xs text-[var(--color-secondary)]">(inativo)</span>
              ) : null}
            </label>
          ))}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : 'Salvar serviços'}
        </button>
      </div>
    </form>
  );
}
