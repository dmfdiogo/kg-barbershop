import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/rbac';
import { getService, listTenantStaff } from '@/lib/catalog/services';
import { ServiceForm } from '../_components/ServiceForm';

export default async function EditarServicoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireRole('OWNER');

  const [service, staff] = await context.forTenant(async (tx) => {
    const found = await getService(tx, context.tenant.id, id);
    const options = await listTenantStaff(tx, context.tenant.id);
    return [found, options] as const;
  });

  if (!service) notFound();

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Editar serviço</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">{service.name}</p>
      </header>

      <ServiceForm mode="edit" serviceId={service.id} initial={service} staff={staff} />
    </section>
  );
}
