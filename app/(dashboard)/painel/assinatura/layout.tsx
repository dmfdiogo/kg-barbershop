import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER da assinatura da plataforma (tarefa F8.0-B).
 *
 * O painel já exige STAFF (`painel/layout.tsx`), mas assinar, trocar de plano e
 * cancelar são decisões financeiras do dono. Como no portão do clube, negar
 * LANÇANDO — `notFound()`/`redirect()` — e nunca renderizando a negação com
 * `children` montado atrás, que serializaria a tela protegida no payload RSC.
 *
 * Esconder o item do menu não é controle de acesso: as server actions em
 * `./actions.ts` revalidam `requireRole('OWNER')` também.
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

export default async function AssinaturaLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
