import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do clube de assinatura (tarefa F5.0).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a feature aparecer no menu, sem editar arquivo
 * central. Só o dono vê — preço e benefícios do clube são decisão de negócio, e
 * a tela ainda exige `OWNER` no layout e nas server actions.
 */
export const nav: DashboardNavItem = {
  href: '/painel/clube',
  label: 'Clube',
  description: 'Planos de assinatura e benefícios do clube.',
  icon: 'sparkles',
  roles: ['OWNER'],
  order: 40,
};
