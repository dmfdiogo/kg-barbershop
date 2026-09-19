import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu da área de mensagens e privacidade (tarefa F6.2).
 *
 * Só o dono vê: além de configurar opt-out, a tela exporta dados do titular e
 * executa a exclusão — operações sensíveis, de responsabilidade de negócio. O
 * portão do layout e as server actions revalidam `OWNER`; esconder o link não é
 * controle de acesso.
 */
export const nav: DashboardNavItem = {
  href: '/painel/mensagens',
  label: 'Mensagens',
  description: 'Opt-out, consentimento, log de entrega e direitos do titular.',
  icon: 'checklist',
  roles: ['OWNER'],
  order: 45,
};
