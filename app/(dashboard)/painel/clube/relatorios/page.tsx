import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState } from '@/components/dashboard/states';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { formatCents } from '@/lib/money';
import { MEMBERSHIP_CYCLE_LABELS } from '@/lib/membership/plans';
import type { MembershipStatus } from '@/lib/membership/subscription';
import { loadClubReport } from './_lib/reports';

/**
 * Relatórios do clube (tarefa F5.3), para o dono.
 *
 * O layout do segmento `painel/clube` já exige OWNER; como os números são de
 * negócio, a página reafirma o papel e nega LANÇANDO (`notFound()`), nunca
 * renderizando a tela protegida atrás da negação — a armadilha do payload RSC
 * documentada no `CLAUDE.md`.
 *
 * MRR vem do preço CONTRATADO de cada assinatura, normalizado para o mês. O
 * porquê está no topo de `_lib/reports.ts`; a legenda na tela evita que o dono
 * leia o número como "soma dos planos à venda".
 */

const STATUS_LABEL: Record<MembershipStatus, string> = {
  ACTIVE: 'Ativo',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelado',
  EXPIRED: 'Expirado',
};

function statusClass(status: MembershipStatus): string {
  if (status === 'ACTIVE') {
    return 'bg-[var(--color-success-soft)] text-[var(--color-success)]';
  }
  if (status === 'PAST_DUE') {
    return 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';
  }
  return 'bg-[var(--color-muted)] text-[var(--color-secondary)]';
}

async function requireOwnerOrNotFound() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export default async function ClubReportsPage() {
  const context = await requireOwnerOrNotFound();
  const report = await context.forTenant((tx) => loadClubReport(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Relatórios do clube</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            Assinantes, receita recorrente, inadimplência e consumo de créditos.
          </p>
        </div>
        <Link
          href="/painel/clube"
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          Voltar ao clube
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Assinantes ativos" value={String(report.activeSubscribers)} />
        <KpiCard label="Inadimplentes" value={String(report.pastDueSubscribers)} danger={report.pastDueSubscribers > 0} />
        <KpiCard
          label="MRR do clube"
          value={formatCents(report.mrrCents)}
          hint="Receita recorrente mensal, pelo preço contratado de cada assinante ativo."
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Assinantes</h2>
        {report.subscribers.length === 0 ? (
          <EmptyState
            title="Nenhum assinante"
            description="Quando alguém assinar um plano do clube, aparece aqui."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {report.subscribers.map((subscriber) => (
              <li
                key={subscriber.membershipId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{subscriber.customerName}</p>
                  <p className="text-xs text-[var(--color-secondary)]">
                    {subscriber.planName} · {MEMBERSHIP_CYCLE_LABELS[subscriber.cycle]}
                  </p>
                  {subscriber.cardBrand && subscriber.cardLastFour ? (
                    <p className="text-xs text-[var(--color-secondary)]">
                      {subscriber.cardBrand} •••• {subscriber.cardLastFour}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium">
                    {formatCents(subscriber.contractedPriceCents)}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(
                      subscriber.status,
                    )}`}
                  >
                    {STATUS_LABEL[subscriber.status]}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Consumo por serviço</h2>
        {report.consumption.length === 0 ? (
          <EmptyState
            title="Nenhum crédito movimentado"
            description="O consumo aparece quando assinantes usam créditos em agendamentos."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {report.consumption.map((row) => (
              <li
                key={row.serviceId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] p-4"
              >
                <p className="truncate text-sm font-semibold">{row.serviceName}</p>
                <p className="text-xs text-[var(--color-secondary)]">
                  {row.consumedCredits} consumido(s) · {row.outstandingCredits} em aberto
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-[var(--color-secondary)]">
        O MRR soma o preço contratado de cada assinante ativo, convertido para o
        mês conforme o ciclo do plano. Quem já assinou mantém o preço que aceitou,
        mesmo que o plano tenha sido reajustado depois.
      </p>
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  danger = false,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] p-4">
      <p className="text-xs text-[var(--color-secondary)]">{label}</p>
      <p
        className={`text-xl font-semibold ${danger ? 'text-[var(--color-danger)]' : ''}`}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-[var(--color-secondary)]">{hint}</p> : null}
    </div>
  );
}
