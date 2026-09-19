import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { portalBasePath } from '@/components/portal/paths';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import { getTenantContext, toTenantContext } from '@/lib/tenant/context';
import { AccountLogin } from './_components/AccountLogin';
import { AccountView } from './_components/AccountView';
import { loadAccountBookings } from './_lib/account';

/**
 * Área do cliente `/[slug]/minha-conta` (F3.4).
 *
 * SSR: resolve o tenant (memoizado), lê a sessão e o `TenantMember` do tenant
 * ativo. Sem sessão/vínculo, mostra a identificação por OTP — não um 404: a
 * página existe, falta entrar. Com sessão, carrega SOMENTE os agendamentos
 * daquele cliente (filtro por `customerId` + RLS), divididos em próximos e
 * histórico.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: `Meus agendamentos · ${lookup.tenant.name}` } : { title: 'Meus agendamentos' };
}

export default async function MinhaContaPage({
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
    return <AccountLogin basePath={basePath} />;
  }

  const data = await loadAccountBookings(ctx, member.id);

  return <AccountView basePath={basePath} data={data} />;
}
