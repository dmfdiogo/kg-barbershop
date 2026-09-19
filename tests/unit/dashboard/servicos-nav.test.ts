import { describe, expect, it } from 'vitest';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';
import { nav as servicosNav } from '@/app/(dashboard)/painel/servicos/nav';

/**
 * A promessa do shell F2.0: uma feature nova entra no menu só por declarar
 * `nav.ts`, sem editar arquivo-lista central. Este teste usa o glob REAL
 * (`import.meta.glob` resolvido no Vitest), não um mapa montado à mão.
 */
describe('serviços no menu do painel', () => {
  it('o item declara a rota e é restrito ao dono', () => {
    expect(servicosNav.href).toBe('/painel/servicos');
    expect(servicosNav.roles).toEqual(['OWNER']);
  });

  it('a feature aparece no menu descoberto, sem editar arquivo central', () => {
    const items = discoverNavItems();
    expect(items.some((item) => item.href === '/painel/servicos')).toBe(true);
  });

  it('o dono vê serviços; o Staff não', () => {
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/servicos')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/servicos')).toBe(false);
  });
});
