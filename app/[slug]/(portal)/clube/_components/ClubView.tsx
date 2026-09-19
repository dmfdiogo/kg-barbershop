'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatCents } from '@/lib/money';
import { MEMBERSHIP_CYCLE_LABELS } from '@/lib/membership/plans';
import type { MembershipStatus } from '@/lib/membership/subscription';
import { cancelClubMembershipAction } from '../actions';
import type { CustomerClubData, CustomerClubMembership } from '../_lib/types';

/**
 * Visão do clube do cliente (tarefa F5.3).
 *
 * Mostra o plano atual, o saldo de créditos (que é a soma do ledger, vinda do
 * servidor), a próxima cobrança e o cartão que será cobrado. O cancelamento
 * passa por server action; o cliente NUNCA envia o próprio id — só o id da
 * assinatura que a tela já carregou do servidor, e a action reconfere a posse.
 *
 * `PAST_DUE` aparece como "Em atraso": é o critério de inadimplência do produto
 * (`MembershipStatus.PAST_DUE`), nunca uma heurística de data.
 */

const STATUS_LABEL: Record<MembershipStatus, string> = {
  ACTIVE: 'Ativo',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelado',
  EXPIRED: 'Expirado',
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function ClubView({ basePath, data }: { basePath: string; data: CustomerClubData }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [acting, startAct] = useTransition();

  function handleCancel(membership: CustomerClubMembership) {
    setNotice(null);
    setPendingId(membership.id);
    startAct(async () => {
      const result = await cancelClubMembershipAction({ membershipId: membership.id });
      setPendingId(null);
      if (!result.ok) {
        setNotice({ kind: 'error', text: result.message });
        return;
      }
      setNotice({ kind: 'success', text: 'Assinatura cancelada.' });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Meu clube</h1>
        <p className="text-sm text-[var(--color-secondary)]">
          Acompanhe o seu plano, os créditos e a próxima cobrança.
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

      {data.memberships.map((membership) => (
        <MembershipCard
          key={membership.id}
          membership={membership}
          pending={pendingId === membership.id && acting}
          onCancel={() => handleCancel(membership)}
        />
      ))}

      <a
        href={`${basePath}/minha-conta`}
        className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-center text-sm font-semibold"
      >
        Ver meus agendamentos
      </a>

      <a
        href={basePath || '/'}
        className="text-center text-sm text-[var(--color-secondary)] underline"
      >
        Voltar ao início
      </a>
    </div>
  );
}

function MembershipCard({
  membership,
  pending,
  onCancel,
}: {
  membership: CustomerClubMembership;
  pending: boolean;
  onCancel: () => void;
}) {
  const statusClass =
    membership.status === 'ACTIVE'
      ? 'bg-[var(--color-success-soft)] text-[var(--color-success)]'
      : 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{membership.planName}</p>
          <p className="text-sm text-[var(--color-secondary)]">
            {formatCents(membership.contractedPriceCents)} ·{' '}
            {MEMBERSHIP_CYCLE_LABELS[membership.cycle]}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusClass}`}>
          {STATUS_LABEL[membership.status]}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-[var(--color-muted)] px-3 py-2">
          <dt className="text-xs text-[var(--color-secondary)]">Próxima cobrança</dt>
          <dd className="text-sm font-medium">{membership.nextChargeLabel ?? '—'}</dd>
        </div>
        <div className="rounded-lg bg-[var(--color-muted)] px-3 py-2">
          <dt className="text-xs text-[var(--color-secondary)]">Cartão</dt>
          <dd className="text-sm font-medium">
            {membership.cardBrand && membership.cardLastFour
              ? `${membership.cardBrand} •••• ${membership.cardLastFour}`
              : '—'}
          </dd>
        </div>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Créditos do ciclo</h2>
        {membership.benefits.length === 0 ? (
          <p className="text-sm text-[var(--color-secondary)]">
            Este plano não tem créditos de serviço.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {membership.benefits.map((benefit) => (
              <li
                key={benefit.serviceId}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2"
              >
                <span className="min-w-0 truncate text-sm">{benefit.serviceName}</span>
                <span className="shrink-0 text-sm font-semibold">
                  {benefit.balance}
                  {benefit.quantityPerCycle > 0 ? ` de ${benefit.quantityPerCycle}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-lg border border-[var(--color-danger)] px-4 py-2 text-sm font-medium text-[var(--color-danger)] disabled:opacity-60"
      >
        {pending ? 'Cancelando…' : 'Cancelar assinatura'}
      </button>
    </article>
  );
}
