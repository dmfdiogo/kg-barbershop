import { describe, expect, it } from 'vitest';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';
import { nav as equipeNav } from '@/app/(dashboard)/painel/equipe/nav';

/**
 * A equipe entra no menu só por declarar `nav.ts` (descoberta do shell F2.0),
 * e o item é restrito ao dono: Staff não gerencia a própria equipe.
 */
describe('equipe no menu do painel', () => {
  it('o item declara a rota e é restrito ao dono', () => {
    expect(equipeNav.href).toBe('/painel/equipe');
    expect(equipeNav.roles).toEqual(['OWNER']);
  });

  it('a feature aparece no menu descoberto, sem editar arquivo central', () => {
    const items = discoverNavItems();
    expect(items.some((item) => item.href === '/painel/equipe')).toBe(true);
  });

  it('o dono vê equipe; o Staff não', () => {
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/equipe')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/equipe')).toBe(false);
  });
});
