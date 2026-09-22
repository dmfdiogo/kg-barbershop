import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { PortalShell } from '@/components/portal/PortalShell';
import { portalBasePath } from '@/components/portal/paths';
import { getTenantContext } from '@/lib/tenant/context';
import { resolveTheme } from '@/lib/theme/resolve';
import { getAppDomain } from '@/lib/tenant/slugs';

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
  if (!lookup.ok) return {};

  const tenant = lookup.tenant;
  const description = `Agende seu horário na ${tenant.name} pelo celular, sem telefonema.`;

  /**
   * O CARTÃO DE LINK É O PRODUTO CHEGANDO AO CLIENTE FINAL.
   *
   * O dono do salão manda `dominio/${slug}` pelo WhatsApp e cola na bio do
   * Instagram — é o canal de distribuição real, não a busca. Sem estas tags o
   * link vai como URL crua, e URL crua no WhatsApp parece golpe: ninguém clica.
   * Com elas, aparece o nome do salão, a frase e a logo.
   *
   * `openGraph.url` precisa ser absoluta; relativa faz o WhatsApp descartar o
   * cartão inteiro em silêncio.
   */
  const origin = portalOrigin();
  const url = origin ? `${origin}/${tenant.slug}` : undefined;

  return {
    title: tenant.name,
    description,
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: tenant.name,
      title: tenant.name,
      description,
      ...(url ? { url } : {}),
      ...(tenant.logoUrl ? { images: [{ url: tenant.logoUrl, alt: tenant.name }] } : {}),
    },
    twitter: {
      card: tenant.logoUrl ? 'summary_large_image' : 'summary',
      title: tenant.name,
      description,
      ...(tenant.logoUrl ? { images: [tenant.logoUrl] } : {}),
    },
  };
}

/**
 * Origem absoluta do portal, vinda da configuração e nunca do header — a
 * mesma decisão do retorno do checkout (`painel/assinatura/_lib/origin.ts`).
 * Aqui o risco é menor, mas um `og:url` apontando para o domínio de quem
 * forjou o Host mandaria o cartão de link para outro lugar.
 */
function portalOrigin(): string | null {
  try {
    const domain = getAppDomain();
    if (!domain) return null;
    const protocol = domain.startsWith('localhost') || domain.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
    return `${protocol}://${domain}`;
  } catch {
    return null;
  }
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
