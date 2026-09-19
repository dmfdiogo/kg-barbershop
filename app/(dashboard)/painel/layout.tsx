import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { TenantUnavailableError } from '@/lib/tenant/context';
import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { getDashboardNav } from '@/components/dashboard/nav';

/**
 * Portão e shell do painel do estabelecimento (tronco da fase 2, tarefa F2.0).
 *
 * POR QUE O PORTÃO MORA NO SEGMENTO `painel`, E NÃO EM
 * `app/(dashboard)/layout.tsx`: o boundary de `not-found.tsx` fica POR DENTRO
 * do layout do próprio segmento. Um `notFound()` chamado no layout do GRUPO
 * subiria para o 404 da raiz e mostraria "Estabelecimento não encontrado" —
 * mentira, não há estabelecimento nenhum no painel. É a mesma armadilha que a
 * F1.4 encontrou do lado da plataforma (`app/(platform)/plataforma/layout.tsx`).
 *
 * NEGAR LANÇANDO, NUNCA RENDERIZANDO. Se este layout renderizasse uma página de
 * negação mantendo `children` montado atrás, a tela protegida iria serializada
 * no payload RSC e chegaria pela rede a quem não podia vê-la. Por isso só
 * `redirect()`/`notFound()`.
 *
 * O painel exige membro com papel STAFF ou OWNER — daí `requireRole('STAFF')`,
 * que aceita os dois (hierarquia OWNER > STAFF > CUSTOMER). O papel NÃO vem do
 * token: `requireRole` o lê de `TenantMember` para o tenant ativo a cada
 * requisição. A mesma pessoa pode ser OWNER no salão A e CUSTOMER no B, e as
 * duas sessões se comportam diferente — há teste que prova isso.
 *
 * Negativa:
 *   - sem sessão → `redirect('/')` (o portão de login é a F1.2, na raiz);
 *   - sessão sem membership/papel no tenant → `notFound()` (404 do segmento);
 *   - tenant suspenso/inexistente → `notFound()`.
 *
 * O menu é montado por descoberta (`components/dashboard/nav.ts`) e filtrado
 * pelo papel; esconder link não é controle de acesso — as telas de configuração
 * continuam exigindo OWNER nas server actions das folhas.
 */
async function requirePanelContext() {
  try {
    return await requireRole('STAFF');
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'UNAUTHENTICATED') redirect('/');
      notFound();
    }
    if (error instanceof TenantUnavailableError) notFound();
    throw error;
  }
}

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const context = await requirePanelContext();
  const navItems = getDashboardNav(context.role);

  return (
    <DashboardShell tenant={context.tenant} role={context.role} navItems={navItems}>
      {children}
    </DashboardShell>
  );
}
