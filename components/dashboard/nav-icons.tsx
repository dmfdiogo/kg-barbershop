import type { ReactNode, SVGProps } from 'react';
import type { DashboardIconName } from './nav';

type IconProps = SVGProps<SVGSVGElement>;

/**
 * Ícones da navegação do painel. Inline e sem dependência nova; herdam a cor
 * via `currentColor`, então respeitam o tema do tenant. Ficam fora de
 * `components/icons.tsx` (arquivo da F0.4) de propósito: `components/dashboard/**`
 * é do tronco da fase 2 e não altera componentes compartilhados.
 */
function BaseIcon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

const PATHS: Record<DashboardIconName, ReactNode> = {
  home: (
    <>
      <path d="M3.75 10.5 12 3.75l8.25 6.75" />
      <path d="M5.25 9.75V20.25h13.5V9.75" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.75l1.6 4.15L17.75 9.5l-4.15 1.6L12 15.25l-1.6-4.15L6.25 9.5l4.15-1.6z" />
      <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  calendar: (
    <>
      <rect x="4.25" y="5.25" width="15.5" height="14.5" rx="2" />
      <path d="M4.25 9.75h15.5M8.5 3.75v3M15.5 3.75v3" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.75" cy="6.75" r="2.25" />
      <circle cx="6.75" cy="17.25" r="2.25" />
      <path d="M8.9 8.1 19.5 18M19.5 6 8.9 15.9" />
    </>
  ),
  users: (
    <>
      <circle cx="9.5" cy="8.25" r="3.25" />
      <path d="M4 19.5c0-2.6 2.46-4.5 5.5-4.5s5.5 1.9 5.5 4.5" />
      <path d="M16 5.6a3.25 3.25 0 0 1 0 6.3M17.5 15.6c1.6.6 2.5 1.9 2.5 3.9" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.75c-4.55 0-8.25 3.36-8.25 7.5 0 3.1 2.24 5.25 5 5.25h1.25a1.5 1.5 0 0 1 1.5 1.5c0 .9-.65 1.5-.65 2.25 0 .62.5 1 1.15 1 4.55 0 7-3.9 7-8.25 0-4.98-3.7-9.25-8-9.25Z" />
      <circle cx="7.75" cy="10.5" r="1" />
      <circle cx="11.25" cy="7.75" r="1" />
      <circle cx="15.25" cy="9.5" r="1" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.75" />
      <path d="M12 3.75v2M12 18.25v2M20.25 12h-2M5.75 12h-2M17.83 6.17l-1.42 1.42M7.59 16.41l-1.42 1.42M17.83 17.83l-1.42-1.42M7.59 7.59 6.17 6.17" />
    </>
  ),
  chart: (
    <>
      <path d="M4.25 19.75h15.5" />
      <path d="M7.5 19.75v-6M12 19.75V7.5M16.5 19.75v-9" />
    </>
  ),
};

export function NavIcon({ name, ...props }: IconProps & { name?: DashboardIconName }) {
  const path = name ? PATHS[name] : null;
  if (!path) return null;
  return <BaseIcon {...props}>{path}</BaseIcon>;
}
