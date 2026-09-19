import type { Metadata } from 'next';
import { getTenantContext } from '@/lib/tenant/context';
import { AuthCard } from '../_components/AuthCard';
import { AuthNotice } from '../_components/AuthNotice';
import { IdentificationForm } from '../_components/IdentificationForm';
import { safeNextPath } from '../_lib/redirect';
import { codePath, firstSearchParam, type SearchParamsRecord } from '../_lib/routes';

/**
 * Identificação na raiz (F1.2): a forma usada quando o tenant é resolvido pelo
 * host do request — subdomínio (`carlosbarber.app...`) ou domínio próprio. A
 * forma por caminho vive em `/[slug]/entrar`.
 */
export const metadata: Metadata = { title: 'Entrar' };

export default async function EntrarPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstSearchParam(params, 'next'));
  const lookup = await getTenantContext();

  if (!lookup.ok) {
    return (
      <AuthNotice
        title="Entre pelo link do estabelecimento"
        actionHref="/"
        actionLabel="Ir para a página inicial"
      >
        Não identificamos um estabelecimento neste endereço. Abra o link que o
        estabelecimento enviou para acessar a sua conta.
      </AuthNotice>
    );
  }

  return (
    <AuthCard
      eyebrow={lookup.tenant.name}
      title="Acesse sua conta"
      subtitle="Informe seu nome e WhatsApp. Não há senha."
    >
      <IdentificationForm codeHref={codePath('')} nextPath={nextPath} />
    </AuthCard>
  );
}
