import type { ReactNode } from 'react';
import { AuthCard } from './AuthCard';

/**
 * Estado sem formulário: identificação expirada, tenant não resolvido. Sempre
 * com um caminho de saída (voltar e recomeçar / abrir o portal), porque uma
 * tela de login sem ação é um beco sem saída no celular.
 *
 * O link é `<a>` e não `<Link>`: o destino é montado com o slug do tenant em
 * runtime e o `typedRoutes` do Next não consegue estreitar a string.
 */
export function AuthNotice({
  title,
  children,
  actionHref,
  actionLabel,
}: {
  title: string;
  children: ReactNode;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <AuthCard title={title}>
      <p className="text-sm text-[var(--color-secondary)]">{children}</p>
      {actionHref && actionLabel ? (
        <a
          href={actionHref}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
        >
          {actionLabel}
        </a>
      ) : null}
    </AuthCard>
  );
}
