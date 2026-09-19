import { describe, expect, it } from 'vitest';
import {
  buildDashboardMenu,
  discoverNavItems,
  isNavItemVisible,
  listFeatureNames,
  sortNavItems,
  type DashboardNavItem,
  type DashboardNavModuleMap,
} from '@/components/dashboard/nav';

/**
 * Descoberta da navegação do painel (tronco F2.0).
 *
 * A varredura é feita por `import.meta.glob` (resolvido no build), então os
 * testes trabalham sobre o mesmo formato de mapa que o glob entrega — chave do
 * caminho do módulo → módulo. A promessa é "uma feature nova aparece no menu
 * sem editar arquivo central": acrescentar uma chave ao mapa faz o item surgir.
 */

const GLOB_PREFIX = '../../app/(dashboard)/painel';

function moduleKey(feature: string): string {
  return `${GLOB_PREFIX}/${feature}/nav.ts`;
}

function navModule(item: DashboardNavItem): { nav: DashboardNavItem } {
  return { nav: item };
}

describe('descoberta de navegação', () => {
  const modules: DashboardNavModuleMap = {
    [moduleKey('servicos')]: navModule({ href: '/painel/servicos', label: 'Serviços' }),
    [moduleKey('equipe')]: navModule({ href: '/painel/equipe', label: 'Equipe' }),
    // Chave irrelevante com módulo sem `nav`: não deve virar item.
    [`${GLOB_PREFIX}/vazio/nav.ts`]: {},
  };

  it('deriva os nomes das features das chaves do glob, ordenados', () => {
    expect(listFeatureNames(modules)).toEqual(['equipe', 'servicos', 'vazio']);
  });

  it('monta o menu a partir do mapa e ignora módulo sem `nav`', () => {
    const items = discoverNavItems(modules);
    expect(items.map((item) => item.href)).toEqual(['/painel/equipe', '/painel/servicos']);
  });

  it('uma feature nova aparece sem editar nenhum arquivo central', () => {
    const before = discoverNavItems(modules);
    const after = discoverNavItems({
      ...modules,
      [moduleKey('marca')]: navModule({ href: '/painel/marca', label: 'Marca' }),
    });

    expect(after).toHaveLength(before.length + 1);
    expect(after.some((item) => item.href === '/painel/marca')).toBe(true);
  });

  it('mapa vazio devolve menu vazio', () => {
    expect(discoverNavItems({})).toEqual([]);
  });
});

describe('menu sensível ao papel', () => {
  const items: DashboardNavItem[] = [
    { href: '/painel/inicio', label: 'Início', roles: ['OWNER', 'STAFF'], order: 1 },
    { href: '/painel/config', label: 'Configurações', roles: ['OWNER'], order: 2 },
    { href: '/painel/agenda', label: 'Agenda', order: 3 },
  ];

  it('o dono vê todos os itens', () => {
    expect(buildDashboardMenu(items, 'OWNER').map((item) => item.label)).toEqual([
      'Início',
      'Configurações',
      'Agenda',
    ]);
  });

  it('o staff não vê a tela de configuração', () => {
    expect(buildDashboardMenu(items, 'STAFF').map((item) => item.label)).toEqual([
      'Início',
      'Agenda',
    ]);
  });

  it('item sem `roles` é visível a qualquer membro', () => {
    expect(isNavItemVisible({ href: '/painel/agenda', label: 'Agenda' }, 'STAFF')).toBe(true);
    expect(isNavItemVisible({ href: '/painel/agenda', label: 'Agenda' }, 'OWNER')).toBe(true);
  });

  it('ordena por `order` e, no empate, pelo label', () => {
    const ordenados = sortNavItems([
      { href: '/c', label: 'Corte', order: 2 },
      { href: '/a', label: 'Barba', order: 1 },
      { href: '/b', label: 'Banho', order: 1 },
    ]);
    expect(ordenados.map((item) => item.label)).toEqual(['Banho', 'Barba', 'Corte']);
  });
});
