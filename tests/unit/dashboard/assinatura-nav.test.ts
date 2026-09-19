import { describe, expect, it } from 'vitest';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';
import { nav as assinaturaNav } from '@/app/(dashboard)/painel/assinatura/nav';

/**
 * A promessa do shell F2.0: uma feature nova entra no menu só por declarar
 * `nav.ts`, sem editar arquivo-lista central. A assinatura da plataforma
 * (F8.0-B) é mais uma folha que prova isso com o glob REAL — e precisa ficar
 * restrita ao dono, porque decidir plano e cobrança não é papel do Staff.
 */
describe('assinatura no menu do painel', () => {
  it('o item declara a rota e é restrito ao dono', () => {
    expect(assinaturaNav.href).toBe('/painel/assinatura');
    expect(assinaturaNav.roles).toEqual(['OWNER']);
  });

  it('a feature aparece no menu descoberto, sem editar arquivo central', () => {
    const items = discoverNavItems();
    expect(items.some((item) => item.href === '/painel/assinatura')).toBe(true);
  });

  it('o dono vê a assinatura; o Staff não', () => {
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/assinatura')).toBe(
      true,
    );
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/assinatura')).toBe(
      false,
    );
  });
});
