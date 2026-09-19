import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do início do painel (tarefa F2.4).
 *
 * Visível a QUALQUER membro: é o painel operacional — o profissional usa o dia
 * inteiro e precisa ver a própria agenda. Por isso não declara `roles` (vazio =
 * todos). Entra no menu por descoberta, sem editar arquivo central.
 */
export const nav: DashboardNavItem = {
  href: '/painel/inicio',
  label: 'Início',
  description: 'Faturamento, ocupação e agenda do dia.',
  icon: 'home',
  order: 1,
};
