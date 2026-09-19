import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu das configurações do estabelecimento (tarefa F2.4).
 *
 * Entra no menu por descoberta (`painel/nav-registry.ts`), sem editar arquivo
 * central. Visível só ao dono — políticas e endereço são decisão de negócio. O
 * portão da tela (`configuracoes/layout.tsx`) e as server actions revalidam
 * `OWNER`: esconder o link não é controle de acesso.
 */
export const nav: DashboardNavItem = {
  href: '/painel/configuracoes',
  label: 'Configurações',
  description: 'Políticas de agenda e endereço do portal.',
  icon: 'settings',
  roles: ['OWNER'],
  order: 40,
};
