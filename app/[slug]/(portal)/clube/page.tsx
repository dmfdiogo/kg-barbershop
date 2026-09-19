import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { portalBasePath } from '@/components/portal/paths';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import { getTenantContext, toTenantContext } from '@/lib/tenant/context';
import { ClubView } from './_components/ClubView';
import { loadCustomerClub } from './_lib/club';

/**
 * Clube do cliente `/[slug]/clube` (tarefa F5.3), dentro do portal público.
 *
 * EXIGE SESSÃO. Sem sessão/vínculo, a página não mostra nada de ninguém: oferece
 * identificação e manda para `minha-conta`, que já tem o fluxo de OTP. Com
 * sessão, carrega SOMENTE as assinaturas daquele `TenantMember` — o isolamento
 * por cliente é estrutural, porque o `memberId` vem da sessão e o filtro é
 * aplicado no client escopado (ver `_lib/club.ts`).
 *
 * O `notFound()` do tenant indisponível é o mesmo do restante do portal: o
 * layout do segmento já resolve e barra, e a checagem aqui é defensiva.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: `Meu clube · ${lookup.tenant.name}` } : { title: 'Meu clube' };
}

export default async function ClubPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  if (!lookup.ok) notFound();

  const ctx = toTenantContext(lookup);
  const basePath = portalBasePath(lookup);

  const session = await getSession();
  const member = session ? await getMembership(ctx.tenant.id, session.userId) : null;

  if (!session || !member) {
    return (
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Meu clube</h1>
          <p className="text-sm text-[var(--color-secondary)]">
            Entre com o seu WhatsApp para ver o seu plano e os seus créditos.
          </p>
        </header>
        <a
          href={`${basePath}/minha-conta`}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-primary-foreground)]"
        >
          Entrar
        </a>
      </section>
    );
  }

  const data = await loadCustomerClub(ctx, member.id);

  if (data.memberships.length === 0) {
    return (
      <section className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Meu clube</h1>
          <p className="text-sm text-[var(--color-secondary)]">
            Você ainda não assina o clube deste estabelecimento.
          </p>
        </header>
        <a
          href={basePath || '/'}
          className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-center text-sm font-semibold"
        >
          Ver os serviços
        </a>
      </section>
    );
  }

  return <ClubView basePath={basePath} data={data} />;
}
