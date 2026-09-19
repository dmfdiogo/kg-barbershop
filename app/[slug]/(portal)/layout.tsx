import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { portalBasePath } from '@/components/portal/paths';
import { getTenantContext } from '@/lib/tenant/context';
import { resolveTheme } from '@/lib/theme/resolve';

/**
 * Casca do portal `/[slug]` (F3.0).
 *
 * ESTENDE o portão da F1.0 em `app/[slug]/layout.tsx`, não o substitui: a
 * resolução do tenant continua sendo `getTenantContext(slug)` — memoizada por
 * requisição —, e quando ela já barrou o acesso (inexistente, CANCELED,
 * SUSPENDED) este layout nem chega a rodar, porque o layout pai devolve a
 * página própria em vez dos filhos.
 *
 * O que entra aqui é só o que vale para TODA rota do portal: o tema do tenant
 * injetado no SSR e a casca de navegação. A F3.3 (`/agendar`) e a F3.4
 * (`/minha-conta`) nascem dentro desta casca e herdam as duas coisas.
 */

/** Título com o nome do estabelecimento: é o link que o cliente abre no WhatsApp. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: lookup.tenant.name } : {};
}

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);

  // Defensivo: o layout do segmento já lança para os casos de tenant
  // indisponível. Se ainda assim chegar aqui sem tenant, não renderize portal.
  if (!lookup.ok) notFound();

  return (
    <PortalShell
      tenant={lookup.tenant}
      theme={resolveTheme(lookup.tenant)}
      basePath={portalBasePath(lookup)}
    >
      {children}
    </PortalShell>
  );
}
