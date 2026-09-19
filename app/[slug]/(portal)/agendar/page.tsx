import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { portalBasePath } from '@/components/portal/paths';
import { getTenantContext, toTenantContext } from '@/lib/tenant/context';
import { BookingFlow } from './_components/BookingFlow';
import { loadBookingOptions } from './_lib/availability';

/**
 * Fluxo de agendamento do portal `/[slug]/agendar?servico=<id>` (F3.3).
 *
 * O caminho e o nome do parâmetro são o contrato fixado pela F3.0: o CTA do
 * catálogo já aponta para cá. A página é SSR: resolve o tenant (memoizado),
 * lê o serviço pelo client escopado e entrega os dados iniciais ao componente
 * de cliente. O estado do fluxo (profissional, dia, hold, OTP) é do cliente,
 * porque precisa sobreviver à navegação entre etapas.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: `Agendar · ${lookup.tenant.name}` } : { title: 'Agendar' };
}

function firstParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

export default async function AgendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const lookup = await getTenantContext(slug);
  if (!lookup.ok) notFound();

  const basePath = portalBasePath(lookup);
  const serviceId = firstParam(query.servico);
  const options = serviceId
    ? await loadBookingOptions(toTenantContext(lookup), serviceId)
    : null;

  if (!options) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Serviço indisponível</h1>
        <p className="text-sm text-[var(--color-secondary)]">
          Este serviço não está mais disponível para agendamento online.
        </p>
        <a
          href={basePath || '/'}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-primary-foreground)]"
        >
          Ver serviços disponíveis
        </a>
      </section>
    );
  }

  return <BookingFlow basePath={basePath} options={options} />;
}
