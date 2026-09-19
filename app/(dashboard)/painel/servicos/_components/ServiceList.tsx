'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/dashboard/states';
import { deleteServiceAction, setServiceActiveAction } from '@/lib/catalog/actions';
import { formatCentsToBRL } from '@/lib/catalog/money';
import type { PaymentMode, ServiceView } from '@/lib/catalog/types';

/**
 * Lista de serviços com ativar/desativar e exclusão (F2.1).
 *
 * A exclusão nunca apaga o histórico: se o serviço tem agendamento futuro, a
 * action recusa e a tela OFERECE DESATIVAR no mesmo lugar. É a regra de produto
 * do §2 da fase 2 — quem já reservou não pode perder a referência.
 */

const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  ON_SITE: 'Pagar no local',
  DEPOSIT: 'Sinal',
  FULL_PREPAID: 'Total antecipado',
};

function summary(service: ServiceView): string {
  const parts = [`${service.durationMin} min`];
  if (service.bufferMin > 0) parts.push(`+${service.bufferMin} min de buffer`);
  parts.push(PAYMENT_MODE_LABEL[service.paymentMode]);
  return parts.join(' · ');
}

interface ServiceListProps {
  services: ServiceView[];
}

export function ServiceList({ services }: ServiceListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ serviceId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(service: ServiceView) {
    setError(null);
    setOffer(null);
    setPendingId(service.id);
    startTransition(async () => {
      const result = await setServiceActiveAction(service.id, !service.active);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  function handleDelete(service: ServiceView) {
    setError(null);
    setOffer(null);
    setPendingId(service.id);
    startTransition(async () => {
      const result = await deleteServiceAction(service.id);
      setPendingId(null);
      if (result.ok) return;
      if (result.code === 'HAS_FUTURE_BOOKINGS' || result.code === 'HAS_HISTORY') {
        setOffer({ serviceId: service.id, message: result.message });
        return;
      }
      setError(result.message);
    });
  }

  function handleDeactivate(service: ServiceView) {
    setOffer(null);
    setPendingId(service.id);
    startTransition(async () => {
      const result = await setServiceActiveAction(service.id, false);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  if (services.length === 0) {
    return (
      <EmptyState
        title="Nenhum serviço cadastrado"
        description="Crie o primeiro serviço para que os clientes possam agendar pelo portal."
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

      {services.map((service) => {
        const pending = pendingId === service.id;
        const offered = offer?.serviceId === service.id;

        return (
          <article
            key={service.id}
            className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{service.name}</p>
                <p className="mt-0.5 text-xs text-[var(--color-secondary)]">
                  {summary(service)}
                </p>
                <p className="mt-1 text-sm font-medium">
                  {formatCentsToBRL(service.priceCents)}
                </p>
              </div>
              <span
                className={
                  service.active
                    ? 'shrink-0 rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]'
                    : 'shrink-0 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-secondary)]'
                }
              >
                {service.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            <p className="text-xs text-[var(--color-secondary)]">
              {service.staffIds.length === 0
                ? 'Nenhum profissional habilitado.'
                : `${service.staffIds.length} profissional(is) habilitado(s).`}
            </p>

            {offered ? (
              <div className="flex flex-col gap-2 rounded-lg bg-[var(--color-warning-soft)] p-3">
                <p className="text-xs text-[var(--color-warning)]">{offer.message}</p>
                <div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleDeactivate(service)}
                    className="rounded-lg bg-[var(--color-warning)] px-3 py-2 text-xs font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Desativar serviço
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/painel/servicos/${service.id}` as Route}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
              >
                Editar
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleToggle(service)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
              >
                {service.active ? 'Desativar' : 'Ativar'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleDelete(service)}
                className="rounded-lg border border-[var(--color-danger)] px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
              >
                Excluir
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
