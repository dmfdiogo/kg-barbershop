import type { Route } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/rbac';
import { listPlans } from '@/lib/membership/plans';
import { PlanList } from '../_components/PlanList';

export default async function PlanosPage() {
  const context = await requireRole('OWNER');
  const plans = await context.forTenant((tx) => listPlans(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Planos do clube</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            Preço, ciclo e benefícios por ciclo. Reajustar um plano não altera quem já assinou.
          </p>
        </div>
        <Link
          href={'/painel/clube/planos/novo' as Route}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
        >
          Novo plano
        </Link>
      </header>

      <PlanList plans={plans} />
    </section>
  );
}
