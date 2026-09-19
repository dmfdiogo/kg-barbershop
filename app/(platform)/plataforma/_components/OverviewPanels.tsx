import Link from 'next/link';
import type { Route } from 'next';
import { TRIAL_BOOKING_LIMIT } from '@/lib/billing/trial';
import { formatCents } from '@/lib/money';
import type { PlatformMetrics, PlatformTenantRow } from '@/lib/platform/overview';
import {
  KYC_STATUS_LABEL,
  NO_KYC_ACCOUNT,
  TENANT_STATUS_LABEL,
  SUBSCRIPTION_STATUS_LABEL,
  formatPercent,
  planLabel,
  type StatusLabel,
} from '../_lib/presentation';
import { StatusBadge } from './StatusBadge';

/**
 * Apresentação da visão geral da plataforma (tarefa F7.3). Puramente
 * apresentacional: recebe as linhas e as métricas já calculadas pelo servidor.
 * Dinheiro sai por `formatCents` (ponto único, `lib/money.ts`).
 */

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] p-4">
      <p className="text-xs text-[var(--color-secondary)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-secondary)]">{hint}</p> : null}
    </div>
  );
}

export function MetricCards({ metrics }: { metrics: PlatformMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric
        label="MRR"
        value={formatCents(metrics.mrrCents)}
        hint={`${metrics.activeSubscriptions} assinatura(s) ativa(s)`}
      />
      <Metric
        label="Em trial"
        value={String(metrics.trialTenants)}
        hint={`${metrics.totalTenants} tenant(s) no total`}
      />
      <Metric
        label="Conversão de trial"
        value={formatPercent(metrics.conversionRate)}
        hint={`${metrics.convertedTenants} convertido(s)`}
      />
      <Metric
        label="Churn"
        value={formatPercent(metrics.churnRate)}
        hint={`${metrics.canceledSubscriptions} cancelada(s)`}
      />
    </div>
  );
}

function subscriptionLabel(tenant: PlatformTenantRow): StatusLabel {
  return tenant.subscriptionStatus
    ? SUBSCRIPTION_STATUS_LABEL[tenant.subscriptionStatus]
    : { label: 'Sem assinatura', tone: 'muted' };
}

export function TenantTable({ tenants }: { tenants: PlatformTenantRow[] }) {
  if (tenants.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--color-border)] px-6 py-10 text-center text-sm text-[var(--color-secondary)]">
        Nenhum estabelecimento cadastrado.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-secondary)]">
            <th className="px-4 py-3 font-medium">Estabelecimento</th>
            <th className="px-4 py-3 font-medium">Situação</th>
            <th className="px-4 py-3 font-medium">Plano</th>
            <th className="px-4 py-3 font-medium">Assinatura</th>
            <th className="px-4 py-3 font-medium">Agendas</th>
            <th className="px-4 py-3 font-medium">Recebimento</th>
            <th className="px-4 py-3 font-medium text-right">Suporte</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => {
            const kyc = tenant.kycStatus ? KYC_STATUS_LABEL[tenant.kycStatus] : NO_KYC_ACCOUNT;
            return (
              <tr
                key={tenant.id}
                className="border-b border-[var(--color-border)] last:border-b-0"
              >
                <td className="px-4 py-3">
                  <span className="block font-medium">{tenant.name}</span>
                  <span className="block text-xs text-[var(--color-secondary)]">
                    /{tenant.slug}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={TENANT_STATUS_LABEL[tenant.status]} />
                </td>
                <td className="px-4 py-3">{planLabel(tenant.plan)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={subscriptionLabel(tenant)} />
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {tenant.activeAgendas}
                  <span className="text-[var(--color-secondary)]">
                    {' '}
                    ativa(s) · trial {tenant.trialBookingsUsed}/{TRIAL_BOOKING_LIMIT}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={kyc} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/plataforma/tenants/${tenant.id}` as Route}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
                  >
                    Abrir
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
