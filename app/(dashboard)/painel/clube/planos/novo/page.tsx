import { requireRole } from '@/lib/auth/rbac';
import { listPlanServiceOptions } from '@/lib/membership/plans';
import { PlanForm } from '../../_components/PlanForm';

export default async function NovoPlanoPage() {
  const context = await requireRole('OWNER');
  const services = await context.forTenant((tx) =>
    listPlanServiceOptions(tx, context.tenant.id),
  );

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Novo plano</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Defina o preço, o ciclo e quantos serviços o assinante ganha por ciclo.
        </p>
      </header>

      <PlanForm mode="create" services={services} />
    </section>
  );
}
