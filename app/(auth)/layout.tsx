import type { ReactNode } from 'react';

/**
 * Casca das telas de autenticação (F1.2).
 *
 * Mobile-first de verdade: a cliente final abre o link no celular, vindo do
 * WhatsApp. Uma coluna, largura confortável de leitura (`max-w-sm`) e alvo de
 * toque de pelo menos 44px nos botões e campos. Em telas grandes o cartão fica
 * centralizado, sem media query própria.
 *
 * Nenhuma cor literal: só tokens de tema (`contexto-comum.md` §2), porque o
 * login também vive sob o domínio de um tenant que customiza a marca.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--color-background)] px-4 py-8 text-[var(--color-foreground)]">
      <main className="w-full max-w-sm">{children}</main>
    </div>
  );
}
