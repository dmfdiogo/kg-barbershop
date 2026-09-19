import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu da feature de exemplo (tronco F2.0).
 *
 * Esta rota existe só para provar a descoberta: nenhum arquivo central precisou
 * ser editado para que ela apareça no menu. As folhas F2.1–F2.4 criarão os seus
 * próprios `nav.ts` e podem remover este placeholder.
 */
export const nav: DashboardNavItem = {
  href: '/painel/exemplo',
  label: 'Exemplo',
  description: 'Rota de demonstração do shell do painel.',
  icon: 'sparkles',
  roles: ['OWNER', 'STAFF'],
  order: 10,
};
