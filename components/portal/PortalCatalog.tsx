import { serviceBookingHref } from '@/components/portal/paths';
import { formatCents, formatDuration } from '@/components/portal/format';
import type { PortalService } from '@/components/portal/catalog';

/**
 * Catálogo de serviços do portal (F3.0): duração e preço com a modalidade de
 * cobrança (spec §3.2), em cartões de uma coluna — mobile-first, o destino é o
 * celular vindo de um link de WhatsApp.
 *
 * O botão aponta para o fluxo de agendamento da F3.3 (`/<slug>/agendar`), que
 * ainda não existe nesta tarefa; o parâmetro `servico` é a costura para a
 * seleção já chegar feita na primeira etapa daquele fluxo.
 */

function paymentModeLabel(service: Pick<PortalService, 'paymentMode' | 'depositCents' | 'depositPercent'>): string {
  switch (service.paymentMode) {
    case 'FULL_PREPAID':
      return 'Pagamento online';
    case 'DEPOSIT':
      if (service.depositCents && service.depositCents > 0) {
        return `Sinal de ${formatCents(service.depositCents)}`;
      }
      if (service.depositPercent && service.depositPercent > 0) {
        return `Sinal de ${service.depositPercent}%`;
      }
      return 'Sinal antecipado';
    case 'ON_SITE':
      return 'Pagamento no local';
  }
}

function ServiceCard({ service, basePath }: { service: PortalService; basePath: string }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">{service.name}</h3>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            {formatDuration(service.durationMin)}
          </p>
          <p className="mt-2 inline-block rounded-full bg-[var(--color-muted)] px-3 py-1 text-xs text-[var(--color-secondary)]">
            {paymentModeLabel(service)}
          </p>
        </div>
        <p className="whitespace-nowrap text-base font-semibold">{formatCents(service.priceCents)}</p>
      </div>

      <a
        href={serviceBookingHref(basePath, service.id)}
        aria-label={`Agendar ${service.name}`}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90"
      >
        Agendar
      </a>
    </li>
  );
}

export function PortalCatalog({
  tenantName,
  services,
  basePath,
}: {
  tenantName: string;
  services: PortalService[];
  basePath: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h1 className="text-2xl font-bold">{tenantName}</h1>
        <p className="mt-2 text-sm text-[var(--color-secondary)]">
          Escolha um serviço para agendar seu horário.
        </p>
      </section>

      <section aria-labelledby="catalogo-titulo" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="catalogo-titulo" className="text-lg font-semibold">
            Serviços
          </h2>
          {services.length > 0 && (
            <p className="text-sm text-[var(--color-secondary)]">
              {services.length === 1 ? '1 opção' : `${services.length} opções`}
            </p>
          )}
        </div>

        {services.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-secondary)]">
            O estabelecimento ainda não publicou serviços para agendamento
            online.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {services.map((service) => (
              <ServiceCard key={service.id} service={service} basePath={basePath} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
