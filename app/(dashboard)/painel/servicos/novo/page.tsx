import { requireRole } from '@/lib/auth/rbac';
import { listTenantStaff } from '@/lib/catalog/services';
import { ServiceForm } from '../_components/ServiceForm';

export default async function NovoServicoPage() {
  const context = await requireRole('OWNER');
  const staff = await context.forTenant((tx) => listTenantStaff(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Novo serviço</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Defina preço, duração e quem pode atender.
        </p>
      </header>

      <ServiceForm mode="create" staff={staff} />
    </section>
  );
}
