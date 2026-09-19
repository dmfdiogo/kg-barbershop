import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { formatCents } from '@/lib/money';
import { TRIAL_BOOKING_LIMIT } from '@/lib/billing/trial';
import type { TenantSupportContext } from '@/lib/platform/support';
import {
  BOOKING_STATUS_LABEL,
  KYC_STATUS_LABEL,
  NO_KYC_ACCOUNT,
  SUBSCRIPTION_STATUS_LABEL,
  TENANT_STATUS_LABEL,
  formatDateTime,
  planLabel,
} from '../../../_lib/presentation';
import { StatusBadge } from '../../../_components/StatusBadge';

/**
 * Apresentação da ficha de suporte de um tenant (tarefa F7.3). O dado já veio
 * auditado de `getTenantSupportContext`; aqui só se desenha. Datas no fuso do
 * tenant — o painel do Super Admin lê o mesmo relógio que o salão enxerga.
 */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-secondary)]">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SupportHeader({ context }: { context: TenantSupportContext }) {
  const { tenant } = context;
  return (
    <header className="flex flex-col gap-3">
      <Link
        href={'/plataforma' as Route}
        className="text-xs text-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
      >
        ← Visão geral
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{tenant.name}</h1>
        <StatusBadge status={TENANT_STATUS_LABEL[tenant.status]} />
      </div>
      <p className="text-sm text-[var(--color-secondary)]">
        /{tenant.slug}
        {tenant.customDomain ? ` · ${tenant.customDomain}` : ''} · fuso {tenant.timezone}
      </p>
    </header>
  );
}

export function SupportSummary({ context }: { context: TenantSupportContext }) {
  const { subscription, receivingAccount, usage } = context;
  const kyc = receivingAccount ? KYC_STATUS_LABEL[receivingAccount.kycStatus] : NO_KYC_ACCOUNT;

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card title="Assinatura">
        {subscription ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{planLabel(subscription.plan)}</span>
              <StatusBadge status={SUBSCRIPTION_STATUS_LABEL[subscription.status]} />
            </div>
            {subscription.currentPeriodEnd ? (
              <p className="text-xs text-[var(--color-secondary)]">
                Período até {formatDateTime(subscription.currentPeriodEnd, context.tenant.timezone)}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-secondary)]">
            Trial do produto · {context.tenant.trialBookingsUsed}/{TRIAL_BOOKING_LIMIT} agendamentos usados
          </p>
        )}
      </Card>

      <Card title="Conta de recebimento">
        <div className="flex items-center gap-2">
          <StatusBadge status={kyc} />
        </div>
        {receivingAccount ? (
          <p className="mt-3 text-xs text-[var(--color-secondary)]">
            {receivingAccount.asaasAccountId}
            <br />
            Pix: {receivingAccount.pixKey}
          </p>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-secondary)]">
            Subconta ainda não criada; pagamento no local.
          </p>
        )}
      </Card>

      <Card title="Uso">
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Agendas ativas">{usage.activeAgendas}</Field>
          <Field label="Agendamentos">{usage.totalBookings}</Field>
          <Field label="Futuros">{usage.upcomingBookings}</Field>
          <Field label="Trial usado">
            {context.tenant.trialBookingsUsed}/{TRIAL_BOOKING_LIMIT}
          </Field>
        </dl>
      </Card>
    </div>
  );
}

export function SupportBookings({ context }: { context: TenantSupportContext }) {
  const { recentBookings, tenant } = context;

  return (
    <Card title="Agendamentos recentes">
      {recentBookings.length === 0 ? (
        <p className="text-sm text-[var(--color-secondary)]">
          Este estabelecimento ainda não tem agendamentos.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-secondary)]">
                <th className="py-2 pr-4 font-medium">Quando</th>
                <th className="py-2 pr-4 font-medium">Cliente</th>
                <th className="py-2 pr-4 font-medium">Serviço</th>
                <th className="py-2 pr-4 font-medium">Situação</th>
                <th className="py-2 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {recentBookings.map((booking) => (
                <tr key={booking.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <td className="py-2 pr-4 tabular-nums">
                    {formatDateTime(booking.startsAt, tenant.timezone)}
                  </td>
                  <td className="py-2 pr-4">{booking.customerName ?? 'Sem cliente'}</td>
                  <td className="py-2 pr-4">{booking.serviceName}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={BOOKING_STATUS_LABEL[booking.status]} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(booking.priceCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function SupportAuditTrail({ context }: { context: TenantSupportContext }) {
  const { recentAuditLogs, tenant } = context;

  return (
    <Card title="Trilha de auditoria">
      <p className="text-xs text-[var(--color-secondary)]">
        Todo acesso de suporte a este estabelecimento é registrado aqui.
      </p>
      {recentAuditLogs.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--color-secondary)]">Nenhum registro ainda.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-[var(--color-border)]">
          {recentAuditLogs.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <span className="text-sm font-medium">{entry.action}</span>
              <span className="text-xs text-[var(--color-secondary)] tabular-nums">
                {formatDateTime(entry.createdAt, tenant.timezone)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
