import type { Route } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/rbac';
import { listServices } from '@/lib/catalog/services';
import { ServiceList } from './_components/ServiceList';

export default async function ServicosPage() {
  const context = await requireRole('OWNER');
  const services = await context.forTenant((tx) => listServices(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Serviços</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            Duração, buffer entre atendimentos, preço e forma de cobrança.
          </p>
        </div>
        <Link
          href={'/painel/servicos/novo' as Route}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
        >
          Novo serviço
        </Link>
      </header>

      <ServiceList services={services} />
    </section>
  );
}
