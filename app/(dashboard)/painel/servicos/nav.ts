import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do catálogo de serviços (tarefa F2.1).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a feature aparecer no menu, sem editar arquivo
 * central. Só o dono vê — gerenciar preço é decisão de negócio, e a tela ainda
 * exige `OWNER` no layout e nas server actions.
 */
export const nav: DashboardNavItem = {
  href: '/painel/servicos',
  label: 'Serviços',
  description: 'Catálogo, preços e forma de cobrança.',
  icon: 'scissors',
  roles: ['OWNER'],
  order: 10,
};
