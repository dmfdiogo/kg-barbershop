import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant/context';
import { AuthCard } from '../../_components/AuthCard';
import { AuthNotice } from '../../_components/AuthNotice';
import { IdentificationForm } from '../../_components/IdentificationForm';
import { safeNextPath } from '../../_lib/redirect';
import { codePath, firstSearchParam, type SearchParamsRecord } from '../../_lib/routes';

/**
 * Identificação na forma por caminho (`/[slug]/entrar`), usada no portal de
 * `app.bomhorario.com.br/carlosbarber`. O proxy injeta o slug do primeiro segmento
 * e a server action resolve o mesmo tenant — nenhuma página inventa tenantId.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: `Entrar · ${lookup.tenant.name}` } : { title: 'Entrar' };
}

export default async function TenantEntrarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const lookup = await getTenantContext(slug);

  if (!lookup.ok) {
    if (lookup.reason === 'suspended') {
      return (
        <AuthNotice title="Estabelecimento temporariamente suspenso">
          {lookup.tenant?.name
            ? `O portal de ${lookup.tenant.name} está fora do ar temporariamente.`
            : 'Este portal está fora do ar temporariamente.'}
        </AuthNotice>
      );
    }
    notFound();
  }

  const basePath = `/${lookup.tenant.slug}`;
  const nextPath = safeNextPath(firstSearchParam(query, 'next'));

  return (
    <AuthCard
      eyebrow={lookup.tenant.name}
      title="Acesse sua conta"
      subtitle="Informe seu nome e WhatsApp. Não há senha."
    >
      <IdentificationForm codeHref={codePath(basePath)} nextPath={nextPath} />
    </AuthCard>
  );
}
