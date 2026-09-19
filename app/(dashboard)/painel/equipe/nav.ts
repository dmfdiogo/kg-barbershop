import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu de equipe (tarefa F2.2).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a feature aparecer no menu, sem editar arquivo
 * central. Só o dono vê — gerenciar equipe, jornada e bloqueios é configuração,
 * e o Staff não gerencia a própria equipe. Esconder o link não é controle de
 * acesso: o layout e as server actions exigem `OWNER`.
 */
export const nav: DashboardNavItem = {
  href: '/painel/equipe',
  label: 'Equipe',
  description: 'Profissionais, jornadas e bloqueios.',
  icon: 'users',
  roles: ['OWNER'],
  order: 20,
};
