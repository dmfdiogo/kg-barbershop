import type { ReactNode } from 'react';
import type { Role } from '@/lib/auth/types';
import type { DashboardNavItem } from './nav';
import { DashboardNav } from './DashboardNav';

/**
 * Casca do painel do estabelecimento (tronco da fase 2, tarefa F2.0).
 *
 * Mobile-first: barra inferior fixa no celular (é assim que o dono e o
 * prestador usam o produto) e barra lateral a partir de `md`. Só token de tema,
 * nunca cor literal — `components/**` é varrido por
 * `tests/unit/components-theme.test.ts`.
 *
 * O menu já chega filtrado pelo papel (quem chama é o layout, depois de
 * `requireRole`); este componente não decide permissão, só apresenta.
 */

const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Dono',
  STAFF: 'Equipe',
  CUSTOMER: 'Cliente',
};

interface DashboardShellProps {
  tenant: { name: string; logoUrl?: string | null };
  role: Role;
  navItems: DashboardNavItem[];
  children: ReactNode;
}

export function DashboardShell({ tenant, role, navItems, children }: DashboardShellProps) {
  const initial = tenant.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-background)]">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-sm font-semibold text-[var(--color-background)]"
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{tenant.name}</span>
            <span className="block text-xs text-[var(--color-secondary)]">{ROLE_LABEL[role]}</span>
          </span>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-[var(--color-border)] p-3 md:block">
          <DashboardNav items={navItems} variant="sidebar" />
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-8">{children}</main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 md:hidden">
        <DashboardNav items={navItems} variant="bottom" />
      </div>
    </div>
  );
}
