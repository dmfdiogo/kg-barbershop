'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { EmptyState } from '@/components/dashboard/states';
import {
  deletePlanAction,
  setPlanActiveAction,
} from '@/app/(dashboard)/painel/clube/actions';
import {
  MEMBERSHIP_CYCLE_LABELS,
  type MembershipPlanView,
} from '@/lib/membership/plans';
import { formatCents } from '@/lib/money';
import { formatPlanBenefits } from '../_lib/format';

/**
 * Lista de planos com ativar/desativar e exclusão (F5.0).
 *
 * A exclusão nunca apaga quem já assinou: se o plano tem assinatura, a action
 * recusa e a tela OFERECE DESATIVAR no mesmo lugar. É o mesmo desenho do
 * catálogo de serviços — o vínculo do assinante não pode sumir com o preço
 * contratado que ele aceitou.
 */

interface PlanListProps {
  plans: MembershipPlanView[];
}

export function PlanList({ plans }: PlanListProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [offer, setOffer] = useState<{ planId: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(plan: MembershipPlanView) {
    setError(null);
    setOffer(null);
    setPendingId(plan.id);
    startTransition(async () => {
      const result = await setPlanActiveAction(plan.id, !plan.active);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  function handleDelete(plan: MembershipPlanView) {
    setError(null);
    setOffer(null);
    setPendingId(plan.id);
    startTransition(async () => {
      const result = await deletePlanAction(plan.id);
      setPendingId(null);
      if (result.ok) return;
      if (result.code === 'HAS_MEMBERSHIPS') {
        setOffer({ planId: plan.id, message: result.message });
        return;
      }
      setError(result.message);
    });
  }

  function handleDeactivate(plan: MembershipPlanView) {
    setOffer(null);
    setPendingId(plan.id);
    startTransition(async () => {
      const result = await setPlanActiveAction(plan.id, false);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  if (plans.length === 0) {
    return (
      <EmptyState
        title="Nenhum plano cadastrado"
        description="Crie o primeiro plano para vender assinaturas do salão no portal."
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

      {plans.map((plan) => {
        const pending = pendingId === plan.id;
        const offered = offer?.planId === plan.id;

        return (
          <article
            key={plan.id}
            className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{plan.name}</p>
                <p className="mt-0.5 text-sm font-medium">
                  {formatCents(plan.priceCents)} · {MEMBERSHIP_CYCLE_LABELS[plan.cycle]}
                </p>
                <p className="mt-1 text-xs text-[var(--color-secondary)]">
                  {formatPlanBenefits(plan.benefits)}
                </p>
              </div>
              <span
                className={
                  plan.active
                    ? 'shrink-0 rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]'
                    : 'shrink-0 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs font-medium text-[var(--color-secondary)]'
                }
              >
                {plan.active ? 'Ativo' : 'Inativo'}
              </span>
            </div>

            {offered ? (
              <div className="flex flex-col gap-2 rounded-lg bg-[var(--color-warning-soft)] p-3">
                <p className="text-xs text-[var(--color-warning)]">{offer.message}</p>
                <div>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => handleDeactivate(plan)}
                    className="rounded-lg bg-[var(--color-warning)] px-3 py-2 text-xs font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    Desativar plano
                  </button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Link
                href={`/painel/clube/planos/${plan.id}` as Route}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
              >
                Editar
              </Link>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleToggle(plan)}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
              >
                {plan.active ? 'Desativar' : 'Ativar'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => handleDelete(plan)}
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
