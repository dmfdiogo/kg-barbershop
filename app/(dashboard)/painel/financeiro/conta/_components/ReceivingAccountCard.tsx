'use client';

import { useState, useTransition } from 'react';
import type {
  ReceivingCapability,
  ReceivingUnavailableReason,
} from '@/lib/payments/merchant';
import { createReceivingAccountAction } from '../actions';

/**
 * Cartão da conta de recebimento (tarefa F4.1).
 *
 * CAMINHO DEGRADADO VISÍVEL. Qualquer estado que não seja `APPROVED` deixa
 * claro, no topo da tela, que os agendamentos continuam funcionando com
 * pagamento no local. O dono nunca fica sem saber o que fazer: cada estado traz
 * uma frase de situação e o que falta.
 *
 * Só recebe `capability` (a chave da subconta NÃO sai do servidor — nem
 * decifrada nem cifrada). O botão cria a conta pela server action, que revalida
 * o papel.
 */

const STATUS_STYLE: Record<
  'APPROVED' | 'PENDING' | 'REJECTED' | 'NONE',
  { label: string; className: string }
> = {
  APPROVED: {
    label: 'Aprovado',
    className: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  },
  PENDING: {
    label: 'Em análise',
    className: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  },
  REJECTED: {
    label: 'Recusado',
    className: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  },
  NONE: {
    label: 'Não criada',
    className: 'bg-[var(--color-muted)] text-[var(--color-secondary)]',
  },
};

function statusKey(capability: ReceivingCapability): keyof typeof STATUS_STYLE {
  if (!capability.account) return 'NONE';
  return capability.account.kycStatus;
}

const REASON_MESSAGE: Record<ReceivingUnavailableReason, string> = {
  NO_ACCOUNT: 'Pagamento no local liberado. Crie a conta quando quiser receber online.',
  KYC_PENDING: 'Pagamento no local liberado enquanto o cadastro está em análise.',
  KYC_REJECTED: 'Pagamento no local liberado. O recebimento online está indisponível.',
};

export function ReceivingAccountCard({ capability }: { capability: ReceivingCapability }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const style = STATUS_STYLE[statusKey(capability)];

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createReceivingAccountAction();
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{capability.account?.accountId ?? 'Sem conta'}</p>
          <p className="mt-0.5 text-xs text-[var(--color-secondary)]">Situação do recebimento</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
          {style.label}
        </span>
      </div>

      <p className="text-sm" role="status">
        {capability.summary}
      </p>

      {!capability.online ? (
        <p className="rounded-lg bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-secondary)]">
          {REASON_MESSAGE[capability.reason as ReceivingUnavailableReason]}
        </p>
      ) : null}

      {capability.requirement ? (
        <p className="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-xs text-[var(--color-warning)]">
          {capability.requirement}
        </p>
      ) : null}

      {capability.account ? (
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[var(--color-secondary)]">Chave Pix</dt>
            <dd className="mt-0.5 font-medium">{capability.account.pixKey}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-secondary)]">Carteira</dt>
            <dd className="mt-0.5 break-all font-medium">{capability.account.walletId}</dd>
          </div>
        </dl>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {!capability.account ? (
        <div>
          <button
            type="button"
            disabled={pending}
            onClick={handleCreate}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {pending ? 'Criando conta…' : 'Criar conta de recebimento'}
          </button>
        </div>
      ) : null}
    </article>
  );
}
