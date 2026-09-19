'use client';

import { useState, useTransition } from 'react';
import type {
  MessagingCustomerView,
  MessagingDeliveryView,
  MessagingOverview,
} from '@/lib/messaging/preferences';
import type { NotificationStatus } from '@prisma/client';
import { eraseCustomerAction, setMessagingOptOutAction } from '../actions';

/**
 * Painel de mensagens e privacidade (tarefa F6.2).
 *
 * Três blocos, cada um com o que o piloto precisa:
 *  - preferências por cliente, com o consentimento (quando e por qual canal) e o
 *    controle de opt-out;
 *  - log de entrega com `providerMessageId` e, principalmente, o MOTIVO da falha
 *    — é ele que responde "o cliente diz que não recebeu";
 *  - direitos do titular: exportar os dados e anonimizar/excluir.
 *
 * Sem cor literal: só tokens (contexto-comum.md §2).
 */

const TEMPLATE_LABELS: Record<string, string> = {
  booking_confirmation: 'Confirmação',
  booking_reminder_d1: 'Lembrete D-1',
  booking_reminder_h2: 'Lembrete H-2',
  booking_cancelled_customer: 'Cancelamento (cliente)',
  booking_cancelled_staff: 'Cancelamento (profissional)',
  booking_rescheduled_customer: 'Remarcação (cliente)',
  booking_rescheduled_staff: 'Remarcação (profissional)',
  booking_created_staff: 'Novo agendamento (profissional)',
  otp_login: 'Código de acesso',
};

const STATUS_LABELS: Record<NotificationStatus, string> = {
  PENDING: 'Pendente',
  SENDING: 'Enviando',
  SENT: 'Enviado',
  FAILED: 'Falhou',
  CANCELED: 'Cancelado',
  SKIPPED: 'Não enviado',
};

function statusClasses(status: NotificationStatus): string {
  switch (status) {
    case 'SENT':
      return 'bg-[var(--color-success-soft)] text-[var(--color-success)]';
    case 'FAILED':
      return 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';
    case 'SKIPPED':
    case 'CANCELED':
      return 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]';
    default:
      return 'bg-[var(--color-muted)] text-[var(--color-secondary)]';
  }
}

function formatDateTime(value: Date | string | null, timeZone: string): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

interface MessagingPanelProps {
  overview: MessagingOverview;
  timeZone: string;
}

export function MessagingPanel({ overview, timeZone }: MessagingPanelProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggleOptOut(customer: MessagingCustomerView) {
    setError(null);
    setPendingId(customer.memberId);
    startTransition(async () => {
      const result = await setMessagingOptOutAction(customer.memberId, !customer.optedOut);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  function eraseCustomer(customer: MessagingCustomerView) {
    const confirmed = window.confirm(
      `Excluir os dados de ${customer.name} neste estabelecimento?\n\n` +
        'O histórico financeiro (agendamentos e pagamentos) é mantido anonimizado ' +
        'por obrigação fiscal. O nome e o telefone deixam de ser usados.',
    );
    if (!confirmed) return;

    setError(null);
    setPendingId(customer.memberId);
    startTransition(async () => {
      const result = await eraseCustomerAction(customer.memberId);
      setPendingId(null);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Clientes com opt-out" value={overview.stats.optedOut} />
        <Stat label="Enviadas" value={overview.stats.sent} />
        <Stat label="Pendentes" value={overview.stats.pending} />
        <Stat label="Falhas" value={overview.stats.failed} danger={overview.stats.failed > 0} />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Preferências e direitos do titular</h2>
        {overview.customers.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-secondary)]">
            Nenhum cliente cadastrado ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {overview.customers.map((customer) => {
              const pending = pendingId === customer.memberId;
              return (
                <li
                  key={customer.memberId}
                  className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{customer.name}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-secondary)]">
                        {customer.phone}
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-secondary)]">
                        {customer.consentAt
                          ? `Consentiu em ${formatDateTime(customer.consentAt, timeZone)}` +
                            (customer.consentSource ? ` (${customer.consentSource})` : '')
                          : 'Sem consentimento registrado.'}
                      </p>
                    </div>
                    <span
                      className={
                        customer.optedOut
                          ? 'shrink-0 rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning)]'
                          : 'shrink-0 rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]'
                      }
                    >
                      {customer.optedOut ? 'Opt-out ativo' : 'Recebe mensagens'}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => toggleOptOut(customer)}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)] disabled:opacity-60"
                    >
                      {customer.optedOut ? 'Voltar a aceitar' : 'Registrar opt-out'}
                    </button>
                    <a
                      href={`/painel/mensagens/exportar?membro=${customer.memberId}`}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
                    >
                      Exportar dados
                    </a>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => eraseCustomer(customer)}
                      className="rounded-lg border border-[var(--color-danger)] px-3 py-2 text-xs font-medium text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
                    >
                      Excluir dados
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Log de entrega</h2>
        {overview.deliveries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center text-sm text-[var(--color-secondary)]">
            Nenhuma mensagem processada até agora.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-[var(--color-muted)] text-[var(--color-secondary)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Mensagem</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Enviado em</th>
                  <th className="px-3 py-2 font-medium">ID do provedor</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {overview.deliveries.map((delivery) => (
                  <DeliveryRow
                    key={delivery.id}
                    delivery={delivery}
                    timeZone={timeZone}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-3">
      <p
        className={
          danger
            ? 'text-lg font-semibold text-[var(--color-danger)]'
            : 'text-lg font-semibold'
        }
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-[var(--color-secondary)]">{label}</p>
    </div>
  );
}

function DeliveryRow({
  delivery,
  timeZone,
}: {
  delivery: MessagingDeliveryView;
  timeZone: string;
}) {
  return (
    <tr className="border-t border-[var(--color-border)] align-top">
      <td className="px-3 py-2">{delivery.customerName ?? '—'}</td>
      <td className="px-3 py-2">
        {TEMPLATE_LABELS[delivery.template] ?? delivery.template}
      </td>
      <td className="px-3 py-2">
        <span
          className={`inline-block rounded-full px-2 py-0.5 font-medium ${statusClasses(
            delivery.status,
          )}`}
        >
          {STATUS_LABELS[delivery.status] ?? delivery.status}
        </span>
      </td>
      <td className="px-3 py-2 text-[var(--color-secondary)]">
        {formatDateTime(delivery.sentAt ?? delivery.createdAt, timeZone)}
      </td>
      <td className="px-3 py-2 font-mono text-[10px] text-[var(--color-secondary)]">
        {delivery.providerMessageId ?? '—'}
      </td>
      <td className="max-w-[16rem] px-3 py-2 text-[var(--color-secondary)]">
        {delivery.lastError ?? '—'}
      </td>
    </tr>
  );
}
