import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { TenantSuspendedPage } from '@/app/tenant-status';
import { getTenantContext } from '@/lib/tenant/context';

/**
 * Portão de tenant do portal `/[slug]` (F1.0; a F3.0 ESTENDE, não substitui).
 *
 * Todas as rotas do portal passam por aqui, então a validação de existência e
 * de status acontece uma vez só, memoizada por requisição:
 *   - inexistente/sem identificador/CANCELED → `notFound()` → 404 com a página
 *     própria (um portal que não volta não deve ficar indexado);
 *   - SUSPENDED → página própria, mantendo a URL e o 200 (o tenant volta);
 *   - ok → o portal (F3) renderiza normalmente.
 *
 * O shell visual e o tema do tenant são da F3.0: este layout só decide se a
 * rota pode renderizar. A F3 pode chamar `getTenantContext(slug)` de novo nos
 * filhos sem custo — o resultado é o mesmo da requisição.
 */
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);

  if (!lookup.ok) {
    if (
      lookup.reason === 'missing' ||
      lookup.reason === 'not_found' ||
      lookup.reason === 'inactive'
    ) {
      notFound();
    }
    return <TenantSuspendedPage tenant={lookup.tenant} />;
  }

  return <>{children}</>;
}
