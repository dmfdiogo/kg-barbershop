'use client';

import type { Route } from 'next';
import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { logoutAction } from '@/lib/auth/actions';

/**
 * Encerrar a sessão.
 *
 * `logoutAction` existia desde a F1.2 e não era chamada de lugar nenhum: dava
 * para entrar no produto e não dava para sair. Não é detalhe de conforto —
 * celular de família e tablet de balcão do salão são os dois aparelhos mais
 * prováveis do nosso público, e em ambos a sessão ficava aberta para o próximo
 * que pegasse o aparelho. Também esvazia o direito do titular da F6.2: não
 * adianta poder apagar o dado se não dá para fechar a sessão.
 *
 * Fica em `components/` porque as duas cascas precisam — o painel do
 * estabelecimento e a área do cliente no portal.
 */
export function LogoutButton({
  className,
  redirectTo = '/',
}: {
  className?: string;
  /** `typedRoutes` exige `Route`; o portal passa o basePath do tenant. */
  redirectTo?: Route;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logoutAction();
          // `replace` e não `push`: voltar no navegador não deve reencenar a
          // tela autenticada a partir do cache do roteador.
          router.replace(redirectTo);
          router.refresh();
        })
      }
      className={
        className ??
        'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)] disabled:opacity-50'
      }
    >
      {pending ? 'Saindo…' : 'Sair'}
    </button>
  );
}
