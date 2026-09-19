import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthError, requireRole } from '@/lib/auth/rbac';

/**
 * Portão de OWNER do onboarding (tarefa F2.5).
 *
 * O painel inteiro já exige STAFF (`painel/layout.tsx`), mas o caminho de
 * configuração inicial é do dono: o Staff que digitar a URL direto recebe o 404
 * do segmento. Negar LANÇANDO — `notFound()`/`redirect()` — e nunca renderizando
 * a negação com `children` montado atrás, que serializaria a tela no payload
 * RSC. Esconder o item do menu não é controle de acesso: as server actions
 * revalidam `OWNER`.
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

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  await requireOwner();
  return <>{children}</>;
}
