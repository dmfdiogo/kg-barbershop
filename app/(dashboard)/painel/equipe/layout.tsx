import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER da área de equipe (tarefa F2.2).
 *
 * O painel inteiro já exige STAFF (`painel/layout.tsx`), mas equipe é
 * configuração: o Staff não acessa nem gerencia os próprios colegas. Como no
 * portão de serviços, negar LANÇANDO — `notFound()`/`redirect()` — e nunca
 * renderizando a negação com `children` montado atrás, que serializaria a tela
 * protegida no payload RSC.
 *
 * Esconder o item do menu não é controle de acesso: as server actions de
 * `lib/staffing/actions.ts` revalidam `requireRole('OWNER')` também.
 */
async function requireOwner() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'UNAUTHENTICATED') redirect('/');
      notFound();
    }
    throw error;
  }
}

export default async function EquipeLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
