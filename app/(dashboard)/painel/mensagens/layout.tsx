import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER da área de mensagens e privacidade (tarefa F6.2).
 *
 * Mesma regra do catálogo de serviços: negar LANÇANDO (`notFound()`/`redirect()`),
 * nunca renderizando a negação com `children` montado atrás — isso serializaria
 * a tela protegida no payload RSC. As server actions e a rota de exportação
 * revalidam `OWNER`; o layout só barra a navegação.
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

export default async function MensagensLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
