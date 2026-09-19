import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do recebimento (tarefa F4.1).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a seção aparecer no menu, sem editar arquivo
 * central. Só o dono vê — a conta de recebimento é decisão financeira, e a tela
 * ainda exige `OWNER` no layout e na server action.
 */
export const nav: DashboardNavItem = {
  href: '/painel/financeiro/conta',
  label: 'Recebimento',
  description: 'Conta de recebimento, chave Pix e situação do KYC.',
  icon: 'chart',
  roles: ['OWNER'],
  order: 50,
};
