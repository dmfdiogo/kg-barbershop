import type { DashboardNavItem } from '@/components/dashboard/nav';

/**
 * Item de menu da agenda (tarefa F3.5).
 *
 * Descoberto por `import.meta.glob` a partir de `components/dashboard/nav.ts`:
 * criar este arquivo já faz a feature aparecer no menu, sem editar arquivo
 * central. Atende OWNER e STAFF — a área do prestador é o dia a dia dos dois.
 * O que muda é o ESCOPO (resolvido no servidor): o Owner vê qualquer
 * profissional, o Staff só a si.
 */
export const nav: DashboardNavItem = {
  href: '/painel/agenda',
  label: 'Agenda',
  description: 'Atendimentos do dia e da semana.',
  icon: 'calendar',
  order: 10,
};
