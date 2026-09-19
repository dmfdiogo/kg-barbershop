/**
 * Rotas das telas de autenticação (F1.2).
 *
 * A mesma tela existe em duas formas: na raiz (`/entrar`) quando o tenant é
 * resolvido pelo host (subdomínio ou domínio próprio) e sob o slug
 * (`/carlosbarber/entrar`) quando o tenant vem do caminho — a forma que o
 * portal de `app.agendex.com.br/[slug]` oferece. `basePath` é `''` ou
 * `'/carlosbarber'`; nada de montar string na mão nas páginas.
 */
export function identifyPath(basePath: string): string {
  return `${basePath}/entrar`;
}

export function codePath(basePath: string): string {
  return `${basePath}/entrar/codigo`;
}

export type SearchParamsRecord = Record<string, string | string[] | undefined>;

/** Primeiro valor de um search param, seja ele string ou lista. */
export function firstSearchParam(
  searchParams: SearchParamsRecord | undefined,
  key: string,
): string | null {
  const value = searchParams?.[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** Acrescenta `?next=` a um caminho, preservando o valor para o código. */
export function withNext(path: string, next: string | null): string {
  if (!next) return path;
  const query = new URLSearchParams({ next });
  return `${path}?${query.toString()}`;
}
