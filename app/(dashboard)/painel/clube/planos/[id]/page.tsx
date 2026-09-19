import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/rbac';
import { getPlan, listPlanServiceOptions } from '@/lib/membership/plans';
import { PlanForm } from '../../_components/PlanForm';

export default async function EditarPlanoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireRole('OWNER');

  const [plan, services] = await context.forTenant(async (tx) => {
    const found = await getPlan(tx, context.tenant.id, id);
    const options = await listPlanServiceOptions(tx, context.tenant.id);
    return [found, options] as const;
  });

  if (!plan) notFound();

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Editar plano</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">{plan.name}</p>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          O novo preço vale para novas assinaturas. Quem já assinou continua no preço contratado até
          você migrar.
        </p>
      </header>

      <PlanForm mode="edit" planId={plan.id} initial={plan} services={services} />
    </section>
  );
}
