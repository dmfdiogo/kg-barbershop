/**
 * Regras de slug e leitura de host compartilhadas por `proxy.ts` e
 * `lib/tenant/context.ts` (tarefa F1.0).
 *
 * Este módulo é deliberadamente PURO: sem banco, sem `next/*`. O proxy roda em
 * toda requisição e não pode carregar Prisma no bundle; quem resolve contra o
 * banco é o contexto (`lib/tenant/context.ts`).
 */

/**
 * Headers internos injetados pelo proxy e lidos pelo contexto. São removidos de
 * qualquer requisição que chega de fora antes de serem reescritos — o cliente
 * não pode forjar tenant.
 */
export const TENANT_HOST_HEADER = 'x-tenant-host';
export const TENANT_SLUG_HEADER = 'x-tenant-slug';

/**
 * Segmentos estáticos da raiz que convivem com a rota dinâmica `/[slug]`.
 *
 * O Next resolve o estático primeiro, então a convivência funciona — mas um
 * tenant com slug `painel` ficaria inacessível para sempre. Quem consome esta
 * lista é a configuração de slug da F2; o proxy também a usa para não tratar
 * um segmento estático como candidato a tenant (e para não reescrevê-lo no
 * caminho do subdomínio).
 *
 * Ao criar uma rota estática nova na raiz (ex.: uma tela de auth), acrescente o
 * segmento aqui. Sem isso, um tenant com aquele slug nasce inacessível.
 */
export const RESERVED_SLUGS: readonly string[] = [
  // Rotas que já existem no App Router.
  'painel',
  'plataforma',
  'api',
  'dev',
  // Infra do Next e arquivos públicos.
  '_next',
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'manifest.webmanifest',
  'well-known',
  // Telas de autenticação/conta que a F1.2 e a F1.3 podem criar na raiz.
  'entrar',
  'login',
  'verificar',
  'cadastro',
  'onboarding',
  'sair',
  'logout',
  // Rótulos que não podem virar portal de tenant (colidem com papéis de host).
  'www',
  'admin',
  'app',
  'mail',
  'suporte',
  'status',
];

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

// Um segmento de URL: minúsculas, dígitos e hífen, sem começar/terminar em
// hífen. O tamanho é checado à parte para dar mensagem específica.
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SlugValidationReason = 'empty' | 'too_short' | 'too_long' | 'format' | 'reserved';

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: SlugValidationReason };

/** Minúsculas e sem espaços nas pontas. Não remove acentos de propósito. */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.includes(normalizeSlug(value));
}

/** Formato + tamanho. Não considera a lista de reservados. */
export function isSlugFormat(value: string): boolean {
  const slug = normalizeSlug(value);
  return (
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_FORMAT.test(slug)
  );
}

export function validateSlug(value: string): SlugValidation {
  const slug = normalizeSlug(value);
  if (slug.length === 0) return { ok: false, reason: 'empty' };
  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, reason: 'too_short' };
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, reason: 'too_long' };
  if (!SLUG_FORMAT.test(slug)) return { ok: false, reason: 'format' };
  if (isReservedSlug(slug)) return { ok: false, reason: 'reserved' };
  return { ok: true, slug };
}

/** Mensagem pronta para a configuração de slug (F2), em pt-BR. */
export function slugValidationMessage(reason: SlugValidationReason): string {
  switch (reason) {
    case 'empty':
      return 'Informe o endereço do portal.';
    case 'too_short':
      return `O endereço precisa ter pelo menos ${SLUG_MIN_LENGTH} caracteres.`;
    case 'too_long':
      return `O endereço pode ter no máximo ${SLUG_MAX_LENGTH} caracteres.`;
    case 'format':
      return 'Use apenas letras minúsculas, números e hífen, sem começar ou terminar com hífen.';
    case 'reserved':
      return 'Este endereço é reservado pela plataforma. Escolha outro.';
  }
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/**
 * Normaliza um host para comparação: minúsculas, sem espaço, primeiro valor de
 * uma lista (`x-forwarded-host` pode vir "host, proxy"), sem ponto final.
 * A porta é MANTIDA: em desenvolvimento o domínio base é `localhost:3000`, e é
 * a porta que permite separar `carlosbarber.localhost:3000` do host base.
 */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const first = raw.split(',')[0]?.trim().toLowerCase().replace(/\.+$/, '') ?? '';
  return first.length > 0 ? first : null;
}

export type HostClassification =
  | { kind: 'app'; host: string; slug: null }
  | { kind: 'subdomain'; host: string; slug: string }
  | { kind: 'custom'; host: string; slug: null }
  | { kind: 'missing'; host: null; slug: null };

/**
 * Classifica o host da requisição em relação ao domínio base do SaaS:
 *
 *   - `app`: o próprio domínio base (ex.: `app.bomhorario.com.br`) → forma /[slug];
 *   - `subdomain`: `carlosbarber.app.bomhorario.com.br` → forma subdomínio;
 *   - `custom`: qualquer outro host → candidato a domínio próprio;
 *   - `missing`: sem host confiável.
 *
 * Um prefixo com mais de um rótulo (`a.b.APP_DOMAIN`) NÃO é subdomínio de
 * tenant: é candidato a domínio próprio.
 */
export function classifyHost(
  hostInput: string | null | undefined,
  appDomainInput: string | null | undefined,
): HostClassification {
  const host = normalizeHost(hostInput);
  const appDomain = normalizeHost(appDomainInput);

  if (!host) return { kind: 'missing', host: null, slug: null };
  if (!appDomain) return { kind: 'custom', host, slug: null };
  if (host === appDomain) return { kind: 'app', host, slug: null };

  const suffix = `.${appDomain}`;
  if (host.endsWith(suffix)) {
    const prefix = host.slice(0, host.length - suffix.length);
    if (prefix.length > 0 && !prefix.includes('.')) {
      return { kind: 'subdomain', host, slug: prefix };
    }
  }

  return { kind: 'custom', host, slug: null };
}

export type TenantResolutionSource = 'custom-domain' | 'subdomain' | 'path';

export interface TenantRouteTarget {
  source: TenantResolutionSource;
  /** Slug (subdomínio/path) ou host (domínio próprio). */
  value: string;
}

export interface TenantTargetInput {
  host: string | null | undefined;
  /** Caminho da requisição, começando com `/`. */
  pathname: string;
  appDomain: string | null | undefined;
}

/**
 * Extrai o identificador do tenant na ordem da spec: domínio próprio →
 * subdomínio → `/[slug]`. É só extração: não consulta o banco nem valida a
 * existência do tenant. Segmento reservado, de formato inválido ou raiz sem
 * host não produzem alvo.
 */
export function resolveTenantTarget(input: TenantTargetInput): TenantRouteTarget | null {
  const classification = classifyHost(input.host, input.appDomain);

  if (classification.kind === 'custom') {
    return { source: 'custom-domain', value: classification.host };
  }

  if (classification.kind === 'subdomain') {
    if (!isSlugFormat(classification.slug) || isReservedSlug(classification.slug)) {
      return null;
    }
    return { source: 'subdomain', value: normalizeSlug(classification.slug) };
  }

  if (classification.kind === 'app') {
    const segment = firstPathSegment(input.pathname);
    if (!segment || !isSlugFormat(segment) || isReservedSlug(segment)) return null;
    return { source: 'path', value: normalizeSlug(segment) };
  }

  return null;
}

export function firstPathSegment(pathname: string): string | null {
  const [segment] = pathname.split('?')[0]!.split('/').filter(Boolean);
  return segment ? decodeURIComponent(segment) : null;
}

export function isReservedPath(pathname: string): boolean {
  const segment = firstPathSegment(pathname);
  return segment !== null && isReservedSlug(segment);
}

/**
 * Domínio base do SaaS. Ordem: `APP_DOMAIN` → host de `APP_URL` → porta local.
 * Em produção, nenhuma das duas configurada é erro de configuração: falhar
 * aqui é melhor do que classificar todo host como domínio próprio.
 */
export function getAppDomain(): string {
  const appDomain = normalizeHost(process.env.APP_DOMAIN);
  if (appDomain) return appDomain;

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    try {
      const parsed = normalizeHost(new URL(appUrl).host);
      if (parsed) return parsed;
    } catch {
      // APP_URL malformada cai para o default local; em produção o guard
      // abaixo reprova antes de chegar aqui.
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_DOMAIN (ou APP_URL) precisa estar definida em produção para separar subdomínio de tenant de domínio próprio.',
    );
  }

  return `localhost:${process.env.PORT ?? '3000'}`;
}
