import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu do onboarding guiado (tarefa F2.5).
 *
 * Entra no menu por descoberta (`painel/nav-registry.ts`), sem editar arquivo
 * central. Visível só ao dono — é o caminho de configuração inicial do
 * estabelecimento. `order: 0` o coloca antes de Início: enquanto o salão não
 * estiver configurado, é onde o dono precisa estar. Esconder o link não é
 * controle de acesso: o layout e as server actions exigem `OWNER`.
 */
export const nav: DashboardNavItem = {
  href: '/painel/onboarding',
  label: 'Configuração inicial',
  description: 'Configure o salão em poucos passos e gere o link.',
  icon: 'checklist',
  roles: ['OWNER'],
  order: 0,
};
