import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER das configurações (tarefa F2.4).
 *
 * Mesmo padrão do catálogo: o painel já exige STAFF, mas políticas e endereço
 * são configuração — o Staff não acessa. Negar LANÇANDO (`notFound`/`redirect`),
 * nunca renderizando a negação com `children` montado atrás, que serializaria a
 * tela protegida no payload RSC. As server actions revalidam `OWNER`.
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

export default async function ConfiguracoesLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
