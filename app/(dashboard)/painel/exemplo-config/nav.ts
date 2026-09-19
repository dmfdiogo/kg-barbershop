import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu visível SÓ para o dono (tronco F2.0). Prova o menu sensível ao
 * papel: o Staff não enxerga telas de configuração. Placeholder — as folhas
 * substituem por itens reais de configuração.
 */
export const nav: DashboardNavItem = {
  href: '/painel/exemplo-config',
  label: 'Exemplo de configuração',
  description: 'Item visível apenas para o dono.',
  icon: 'settings',
  roles: ['OWNER'],
  order: 20,
  exact: true,
};
