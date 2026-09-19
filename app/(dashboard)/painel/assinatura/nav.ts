import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu da assinatura da plataforma (tarefa F8.0-B).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a feature aparecer no menu, sem editar arquivo
 * central. Só o dono vê — assinar, trocar de plano e cancelar são decisões
 * financeiras do estabelecimento, e a tela ainda exige `OWNER` no layout e nas
 * server actions.
 *
 * Reusa o ícone `chart` (billing/planos) para não tocar no arquivo central de
 * ícones, que é compartilhado por todas as features.
 */
export const nav: DashboardNavItem = {
  href: '/painel/assinatura',
  label: 'Assinatura',
  description: 'Plano, cobrança e meio de pagamento do sistema.',
  icon: 'chart',
  roles: ['OWNER'],
  order: 35,
};
