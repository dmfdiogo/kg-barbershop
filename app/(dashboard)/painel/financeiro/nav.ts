import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do financeiro (F4.1 → F4.3).
 *
 * A F4.1 criou este item apontando para a conta de recebimento. A F4.3 entrega o
 * saldo e o extrato — a promessa da spec §3.2 de que o dono não abre o painel do
 * Asaas —, então a raiz do financeiro passa a ser o destino e o recebimento vive
 * dentro dela. Descoberto por `import.meta.glob`, só o dono vê; a tela ainda
 * exige OWNER no portão.
 */
export const nav: DashboardNavItem = {
  href: '/painel/financeiro',
  label: 'Financeiro',
  description: 'Saldo, extrato e estorno dos pagamentos recebidos.',
  icon: 'chart',
  roles: ['OWNER'],
  order: 50,
};
