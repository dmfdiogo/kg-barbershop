import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu da tela de marca (tarefa F2.3).
 *
 * Descoberto pelo glob de `painel/nav-registry.ts`: para entrar no menu nenhum
 * arquivo central foi editado. Visível só para o dono — o staff não configura a
 * identidade do estabelecimento. Esconder o link não é controle de acesso: a
 * página e a server action exigem `OWNER`.
 */
export const nav: DashboardNavItem = {
  href: '/painel/marca',
  label: 'Marca',
  description: 'Logo, cores e identidade visual do portal.',
  icon: 'palette',
  roles: ['OWNER'],
  order: 30,
};
