import { notFound } from 'next/navigation';
import { TenantSuspendedPage } from './tenant-status';
import { PortalCatalog } from '@/components/portal/PortalCatalog';
import { PortalShell } from '@/components/portal/PortalShell';
import { loadPortalCatalog } from '@/components/portal/catalog';
import { portalBasePath } from '@/components/portal/paths';
import {
  getTenantContext,
  toTenantContext,
  type TenantLookup,
} from '@/lib/tenant/context';
import { resolveTheme } from '@/lib/theme/resolve';

/**
 * Raiz da aplicação. Em domínio próprio (`www.salao.com.br/`) não existe slug
 * no caminho, então o proxy só injetou `x-tenant-host` — é aqui que a raiz
 * delega para o MESMO resolvedor do portal:
 *
 *   - host casa com um `Tenant.customDomain` → renderiza o portal do tenant;
 *   - SUSPENDED → página própria com 200; CANCELED → `notFound()` (404, não
 *     pode ficar indexado);
 *   - qualquer outro caso (domínio base, host desconhecido) → landing.
 *
 * O recurso de domínio próprio só é vendido no plano Pro (fase 2 do produto),
 * mas o mecanismo fica fechado desde já para a F3.0 não ter de redesenhar o
 * roteamento no meio de uma tarefa de UI.
 */
export default async function Home() {
  const lookup = await getTenantContext();

  if (lookup.ok) {
    return <TenantPortalHome lookup={lookup} />;
  }

  if (lookup.reason === 'inactive') notFound();
  if (lookup.reason === 'suspended') {
    return <TenantSuspendedPage tenant={lookup.tenant} />;
  }

  return <PlatformLanding />;
}

/**
 * Raiz do domínio próprio: o MESMO portal de `/[slug]`, montado com as mesmas
 * peças (casca + catálogo). Antes era um placeholder da F1.0; a F3.0 liga o
 * portal real aqui. `basePath` fica vazio porque a raiz já é o portal.
 */
async function TenantPortalHome({
  lookup,
}: {
  lookup: Extract<TenantLookup, { ok: true }>;
}) {
  const basePath = portalBasePath(lookup);
  const services = await loadPortalCatalog(toTenantContext(lookup));

  return (
    <PortalShell
      tenant={lookup.tenant}
      theme={resolveTheme(lookup.tenant)}
      basePath={basePath}
    >
      <PortalCatalog
        tenantName={lookup.tenant.name}
        services={services}
        basePath={basePath}
      />
    </PortalShell>
  );
}

function PlatformLanding() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Plataforma de agendamento</h1>
      <p className="text-[var(--color-secondary)]">
        Landing da plataforma. Substituída na fase 7.
      </p>
    </main>
  );
}
