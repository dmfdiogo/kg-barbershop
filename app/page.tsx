import { notFound } from 'next/navigation';
import { TenantSuspendedPage } from './tenant-status';
import { getTenantContext, type TenantRoutingInfo } from '@/lib/tenant/context';

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
    return <TenantPortalHome tenant={lookup.tenant} />;
  }

  if (lookup.reason === 'inactive') notFound();
  if (lookup.reason === 'suspended') {
    return <TenantSuspendedPage tenant={lookup.tenant} />;
  }

  return <PlatformLanding />;
}

/**
 * Placeholder do portal para a raiz do domínio próprio. A F3.0 substitui pelo
 * portal real (mesmo componente que serve `/[slug]`).
 */
function TenantPortalHome({ tenant }: { tenant: TenantRoutingInfo }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold">{tenant.name}</h1>
      <p className="text-[var(--color-secondary)]">
        Portal do estabelecimento em domínio próprio. O portal completo é a
        fase 3.
      </p>
    </main>
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
