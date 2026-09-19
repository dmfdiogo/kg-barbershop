import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER da conta de recebimento (tarefa F4.1).
 *
 * O painel inteiro já exige STAFF (`painel/layout.tsx`), mas dados financeiros e
 * a criação da subconta são do dono. Como nos demais portões, negar LANÇANDO —
 * `notFound()`/`redirect()` — e nunca renderizar a negação com `children`
 * montado atrás, que serializaria a tela protegida no payload RSC.
 *
 * Esconder o item do menu não é controle de acesso: a server action de criação
 * revalida `requireRole('OWNER')`.
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

export default async function ContaRecebimentoLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
