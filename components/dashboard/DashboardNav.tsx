'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import type { DashboardNavItem } from './nav';
import { NavIcon } from './nav-icons';

/**
 * Navegação do painel. Componente de cliente por causa do destaque da rota
 * ativa (`usePathname`). Recebe itens serializáveis do shell (Server Component)
 * — o scan de arquivos fica no servidor, nunca no bundle do navegador.
 */
function isActive(pathname: string, item: DashboardNavItem): boolean {
  if (pathname === item.href) return true;
  if (item.exact) return false;
  return pathname.startsWith(`${item.href}/`);
}

interface DashboardNavProps {
  items: DashboardNavItem[];
  variant: 'sidebar' | 'bottom';
}

export function DashboardNav({ items, variant }: DashboardNavProps) {
  const pathname = usePathname();

  if (items.length === 0) {
    return (
      <p className="px-3 py-2 text-sm text-[var(--color-secondary)]">
        Nenhuma área disponível para o seu perfil.
      </p>
    );
  }

  const sidebar = variant === 'sidebar';

  return (
    <nav
      aria-label="Navegação do painel"
      className={sidebar ? 'flex flex-col gap-1' : 'flex items-center gap-1 overflow-x-auto'}
    >
      {items.map((item) => {
        const active = isActive(pathname ?? '', item);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              sidebar ? 'w-full' : 'whitespace-nowrap',
              active
                ? 'bg-[var(--color-muted)] font-semibold text-[var(--color-foreground)]'
                : 'text-[var(--color-secondary)] hover:bg-[var(--color-muted)] hover:text-[var(--color-foreground)]',
            ].join(' ')}
          >
            <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
