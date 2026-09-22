import { notFound } from 'next/navigation';
import { PortalCatalog } from '@/components/portal/PortalCatalog';
import { loadPortalCatalog } from '@/components/portal/catalog';
import { portalBasePath } from '@/components/portal/paths';
import { getTenantContext, toTenantContext } from '@/lib/tenant/context';

/**
 * Catálogo público do estabelecimento em `/[slug]` (F3.0).
 *
 * Renderizado no servidor: o HTML já sai com o tema do tenant (o `<style>` está
 * na casca, em `./layout.tsx`) e com os serviços lidos pelo client escopado. A
 * RLS garante que só o catálogo deste tenant é visível, mesmo sem `where` de
 * tenant na query.
 */
export default async function PortalCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  if (!lookup.ok) notFound();

  const services = await loadPortalCatalog(toTenantContext(lookup));

  return (
    <PortalCatalog
      tenantName={lookup.tenant.name}
      tenantAddress={lookup.tenant.address}
      services={services}
      basePath={portalBasePath(lookup)}
    />
  );
}
