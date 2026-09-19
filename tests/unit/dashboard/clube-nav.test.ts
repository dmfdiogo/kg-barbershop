import { describe, expect, it } from 'vitest';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';
import { nav as clubeNav } from '@/app/(dashboard)/painel/clube/nav';

/**
 * A promessa do shell F2.0: uma feature nova entra no menu só por declarar
 * `nav.ts`, sem editar arquivo-lista central. O clube (F5.0) é mais uma folha
 * que prova isso com o glob REAL.
 */
describe('clube no menu do painel', () => {
  it('o item declara a rota e é restrito ao dono', () => {
    expect(clubeNav.href).toBe('/painel/clube');
    expect(clubeNav.roles).toEqual(['OWNER']);
  });

  it('a feature aparece no menu descoberto, sem editar arquivo central', () => {
    const items = discoverNavItems();
    expect(items.some((item) => item.href === '/painel/clube')).toBe(true);
  });

  it('o dono vê o clube; o Staff não', () => {
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/clube')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/clube')).toBe(false);
  });
});
