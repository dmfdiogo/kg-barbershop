import { describe, expect, it } from 'vitest';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';
import { nav as agendaNav } from '@/app/(dashboard)/painel/agenda/nav';

/**
 * A agenda entra no menu só por declarar `nav.ts` (descoberta do shell F2.0) e
 * é visível ao Owner e ao Staff: a área do prestador é o dia a dia dos dois.
 */
describe('agenda no menu do painel', () => {
  it('o item declara a rota e atende os dois papéis', () => {
    expect(agendaNav.href).toBe('/painel/agenda');
    expect(agendaNav.roles).toBeUndefined();
  });

  it('a feature aparece no menu descoberto, sem editar arquivo central', () => {
    expect(discoverNavItems().some((item) => item.href === '/painel/agenda')).toBe(true);
  });

  it('o dono e o Staff veem a agenda', () => {
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/agenda')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/agenda')).toBe(true);
  });
});
