import type { TenantLookup } from '@/lib/tenant/context';

/**
 * Caminho base do portal conforme a forma de acesso (F3.0).
 *
 * Na forma `/[slug]` os links precisam do slug; no subdomínio
 * (`carlosbarber.app…`) e no domínio próprio (`www.carlosbarber.com.br`) a raiz
 * já é o portal — emitir o slug ali apontaria para `…/carlosbarber/carlosbarber`
 * depois da reescrita do proxy. Quem sabe a forma é o `source` da resolução.
 */
export function portalBasePath(lookup: Extract<TenantLookup, { ok: true }>): string {
  return lookup.source === 'path' ? `/${lookup.tenant.slug}` : '';
}

/** Destino do fluxo de agendamento (F3.3). */
export function serviceBookingHref(basePath: string, serviceId: string): string {
  return `${basePath}/agendar?servico=${encodeURIComponent(serviceId)}`;
}

/** Destino do checkout do hold (F4.2): pagamento da reserva já identificada. */
export function checkoutHref(basePath: string, holdId: string): string {
  return `${basePath}/checkout?reserva=${encodeURIComponent(holdId)}`;
}
