import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';

/**
 * Casca do painel da plataforma (tarefa F7.3).
 *
 * Mesmo padrão de `components/dashboard/DashboardShell` (tronco da F2.0), mas
 * sem `Role` de tenant: aqui não há "dono", "equipe" nem branding — é a área do
 * Super Admin. Fica sob `app/(platform)` de propósito: o portão da F1.4 é o
 * layout do segmento e toda tela nova nasce atrás dele.
 *
 * Sem cor literal — só token de tema, como todo componente de produto.
 */

const NAV: readonly { href: Route; label: string }[] = [
  { href: '/plataforma' as Route, label: 'Visão geral' },
];

export function PlatformShell({
  userName,
  children,
}: {
  userName: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-background)]"
            >
              P
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Plataforma</span>
              <span className="block truncate text-xs text-[var(--color-secondary)]">
                {userName}
              </span>
            </span>
          </div>

          <nav aria-label="Navegação da plataforma" className="flex items-center gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
