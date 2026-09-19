import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER da área de serviços (tarefa F2.1).
 *
 * O painel inteiro já exige STAFF (`painel/layout.tsx`), mas o catálogo é
 * configuração: o Staff não acessa. Como no portão do painel, negar LANÇANDO —
 * `notFound()`/`redirect()` — e nunca renderizando a negação com `children`
 * montado atrás, que serializaria a tela protegida no payload RSC.
 *
 * Esconder o item do menu não é controle de acesso: as server actions de
 * `lib/catalog/actions.ts` revalidam `requireRole('OWNER')` também.
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

export default async function ServicosLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
