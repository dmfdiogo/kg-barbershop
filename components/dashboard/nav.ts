import type { Role } from '@/lib/auth/types';
import { navModules as rawNavModules } from '@/app/(dashboard)/painel/nav-registry';

/**
 * Navegação do painel por DESCOBERTA (tronco da fase 2, tarefa F2.0).
 *
 * O problema que isto resolve está em `fases/paralelizacao.md` §4.1: um
 * arquivo-lista central onde quatro folhas (F2.1–F2.4) acrescentam uma linha é
 * a fonte número um de conflito de merge. Em vez disso, cada feature declara o
 * seu item em `app/(dashboard)/painel/<feature>/nav.ts`, e o menu é montado
 * varrendo a pasta. Uma feature nova aparece no menu sem tocar em arquivo
 * nenhum deste módulo.
 *
 * A varredura é feita por `import.meta.glob` com `eager: true`, RESOLVIDA NO
 * BUILD (Turbopack no Next, Vite no Vitest) — mesma abordagem de
 * `lib/booking/confirm.ts`. Ler o sistema de arquivos em runtime funcionaria em
 * `next start` auto-hospedado, mas quebraria em deploy serverless: a função
 * implantada contém só o bundle rastreado, e uma leitura dinâmica de diretório
 * não é rastreada — o menu viria vazio em produção e verde em todo teste local.
 * O glob entra no bundle, então o conjunto de features é conhecido em tempo de
 * compilação.
 *
 * O valor de `roles` é um CONJUNTO de papéis que enxergam o item — vazio ou
 * ausente significa "qualquer membro" (OWNER e STAFF). Assim uma tela de
 * configuração declara `roles: ['OWNER']` e some do menu do Staff; esconder o
 * link não é controle de acesso (o portão de cada rota continua valendo), mas
 * mantém a área do prestador enxuta.
 */

export type DashboardIconName =
  | 'home'
  | 'sparkles'
  | 'calendar'
  | 'scissors'
  | 'users'
  | 'palette'
  | 'settings'
  | 'chart'
  | 'checklist';

export interface DashboardNavItem {
  /** Caminho absoluto dentro do painel, ex.: `/painel/servicos`. */
  href: string;
  label: string;
  description?: string;
  icon?: DashboardIconName;
  /** Papéis que enxergam o item. Ausente/vazio = todos os membros. */
  roles?: readonly Role[];
  /** Ordem crescente; empate cai no label. Padrão 100. */
  order?: number;
  /**
   * Destaque apenas quando o caminho for exatamente este. Use no item raiz
   * (`/painel`), que de outro modo ficaria ativo em todas as subrotas.
   */
  exact?: boolean;
}

/** O que cada `app/(dashboard)/painel/<feature>/nav.ts` exporta. */
export interface DashboardNavModule {
  nav?: DashboardNavItem;
}

/** Mapa chave-do-glob → módulo, no formato de `import.meta.glob({ eager: true })`. */
export type DashboardNavModuleMap = Record<string, DashboardNavModule>;

/**
 * "eager: true" resolve os módulos no build, então a pasta é varrida em tempo de
 * compilação e a ordem é determinística (alfabética pelo caminho do módulo).
 * Para entrar no menu, basta criar `app/(dashboard)/painel/<feature>/nav.ts`.
 * O glob fica em `painel/nav-registry.ts`, vizinho das features.
 */
const navModules = rawNavModules as DashboardNavModuleMap;

/** Nomes das features que declaram `nav.ts`, derivados das chaves do glob. */
export function listFeatureNames(modules: DashboardNavModuleMap = navModules): string[] {
  return Object.keys(modules)
    .map((key) => key.split('/').slice(-2, -1)[0] ?? '')
    .filter((name) => name.length > 0)
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function isNavItem(value: unknown): value is DashboardNavItem {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { href?: unknown; label?: unknown };
  return typeof candidate.href === 'string' && typeof candidate.label === 'string';
}

export function discoverNavItems(
  modules: DashboardNavModuleMap = navModules,
): DashboardNavItem[] {
  return sortNavItems(
    Object.keys(modules)
      .sort()
      .map((file) => modules[file]?.nav)
      .filter(isNavItem),
  );
}

export function isNavItemVisible(item: DashboardNavItem, role: Role): boolean {
  if (!item.roles || item.roles.length === 0) return true;
  return item.roles.includes(role);
}

export function sortNavItems(items: readonly DashboardNavItem[]): DashboardNavItem[] {
  return [...items].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.label.localeCompare(b.label, 'pt-BR'),
  );
}

export function buildDashboardMenu(
  items: readonly DashboardNavItem[],
  role: Role,
): DashboardNavItem[] {
  return sortNavItems(items.filter((item) => isNavItemVisible(item, role)));
}

/** Menu do painel para o papel informado. O papel vem de `TenantMember` (rbac), nunca do token. */
export function getDashboardNav(role: Role): DashboardNavItem[] {
  return buildDashboardMenu(discoverNavItems(), role);
}
