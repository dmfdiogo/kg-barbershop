import type { Route } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/dashboard/states';
import { requireRole } from '@/lib/auth/rbac';
import { listPlans, MEMBERSHIP_CYCLE_LABELS } from '@/lib/membership/plans';
import { formatCents } from '@/lib/money';
import { formatPlanBenefits } from './_lib/format';

export default async function ClubePage() {
  const context = await requireRole('OWNER');
  const plans = await context.forTenant((tx) => listPlans(tx, context.tenant.id));
  const activeCount = plans.filter((plan) => plan.active).length;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Clube de assinatura</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            {activeCount === 0
              ? 'Nenhum plano ativo. Crie um plano para vender assinaturas do salão.'
              : `${activeCount} plano(s) ativo(s) à venda no portal.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* A F5.3 entregou os relatórios sem link de entrada, por não ser dona
              deste arquivo. Sem esta linha, a tela só existe para quem digita a
              URL. */}
          <Link
            href={'/painel/clube/relatorios' as Route}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--color-muted)]"
          >
            Relatórios
          </Link>
          <Link
            href={'/painel/clube/planos' as Route}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
          >
            Gerenciar planos
          </Link>
        </div>
      </header>

      {plans.length === 0 ? (
        <EmptyState
          title="Nenhum plano cadastrado"
          description="Defina preço, ciclo e os serviços inclusos por ciclo."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {plans.map((plan) => (
            <article
              key={plan.id}
              className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="truncate text-sm font-semibold">{plan.name}</p>
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
              <p className="text-sm font-medium">
                {formatCents(plan.priceCents)} · {MEMBERSHIP_CYCLE_LABELS[plan.cycle]}
              </p>
              <p className="text-xs text-[var(--color-secondary)]">
                {formatPlanBenefits(plan.benefits)}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
