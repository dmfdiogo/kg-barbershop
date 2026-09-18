import { NextResponse, type NextRequest } from 'next/server';
import {
  TENANT_HOST_HEADER,
  TENANT_SLUG_HEADER,
  getAppDomain,
  isReservedPath,
  normalizeHost,
  resolveTenantTarget,
} from '@/lib/tenant/slugs';

/**
 * Proxy de resolução de tenant (tarefa F1.0; no Next 16 o antigo middleware se
 * chama `proxy`).
 *
 * ESCOPO DELIBERADAMENTE ESTREITO: aqui só se EXTRAI o identificador do tenant
 * — host, subdomínio ou primeiro segmento do path — e se repassa adiante por
 * header interno. A resolução de verdade (buscar o Tenant, validar `status`,
 * alimentar o client escopado) acontece em `lib/tenant/context.ts`, na camada
 * de Server Component / route handler, onde dá para memoizar por requisição.
 *
 * O motivo é desempenho, não estilo: o proxy roda em TODA requisição, inclusive
 * as de asset. Um SELECT por requisição seria uma ida ao banco no caminho mais
 * quente da aplicação. Proxy sem banco também mantém o arquivo compatível com
 * Edge, caso o produto volte a rodar aí.
 *
 * Headers injetados:
 *   - `x-tenant-host`: host normalizado (domínio próprio ou porta local);
 *   - `x-tenant-slug`: slug do subdomínio ou do path (só nas formas em que ele
 *     existe; domínio próprio é resolvido pelo host).
 *
 * Os dois headers são APAGADOS da requisição de entrada antes de serem
 * reescritos: sem isso, um cliente poderia forjar o tenant com um header
 * manual. O `x-middleware-override-headers` que o Next monta a partir do
 * `Headers` filtrado garante que os valores forjados não cheguem ao servidor.
 *
 * O proxy NÃO resolve existência nem status do tenant. Um slug que não existe
 * chega ao contexto e vira a página própria de "não encontrado"; um tenant
 * suspenso vira a página de suspenso. Nada de 404 genérico.
 *
 * Domínio próprio: o mecanismo fica pronto aqui (host repassado), mas a
 * requisição à raiz do domínio não tem slug no caminho — quem delega para o
 * mesmo resolvedor é `app/page.tsx`, lendo `x-tenant-host`.
 */

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const host = normalizeHost(
    request.headers.get('x-forwarded-host') ?? request.headers.get('host'),
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TENANT_HOST_HEADER);
  requestHeaders.delete(TENANT_SLUG_HEADER);
  if (host) requestHeaders.set(TENANT_HOST_HEADER, host);

  const target = resolveTenantTarget({ host, pathname, appDomain: getAppDomain() });

  if (target && target.source !== 'custom-domain') {
    requestHeaders.set(TENANT_SLUG_HEADER, target.value);
  }

  // Forma subdomínio: o portal vive em `/[slug]`, então o caminho é reescrito
  // preservando o restante da URL. Segmento reservado (ex.: `/painel`) não é
  // reescrito — é rota da plataforma e resolve o tenant pelo header.
  if (target?.source === 'subdomain' && !isReservedPath(pathname)) {
    const rewriteUrl = request.nextUrl.clone();
    const suffix = pathname === '/' ? '' : pathname;
    rewriteUrl.pathname = `/${target.value}${suffix}`;
    return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Fora do matcher: estáticos do Next e arquivos com extensão. Roda em páginas,
// route handlers, server actions e assets dinâmicos.
export const config = {
  matcher: ['/((?!_next/static|_next/image|.*\\.[^/]+$).*)'],
};
