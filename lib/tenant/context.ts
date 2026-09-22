import { cache } from 'react';
import { headers } from 'next/headers';
import type { Prisma, TenantStatus } from '@prisma/client';
import {
  asPlatformAdmin,
  forTenant as runForTenant,
  type TenantTransaction,
  type TransactionOptions,
} from './db';
import {
  TENANT_HOST_HEADER,
  TENANT_SLUG_HEADER,
  classifyHost,
  getAppDomain,
  isReservedSlug,
  isSlugFormat,
  normalizeSlug,
  type TenantResolutionSource,
} from './slugs';

/**
 * Contexto de requisição multi-tenant (tarefa F1.0).
 *
 * O proxy (`proxy.ts`) só extraiu host/slug e injetou `x-tenant-host` e
 * `x-tenant-slug`. Aqui é que a resolução ACONTECE: buscar o Tenant no banco,
 * validar `status`, memoizar por requisição (`cache()` do React) e entregar um
 * runner no client escopado da F0 — quem consome nunca passa tenantId na mão.
 *
 * ISOLAMENTO (contexto-comum.md §4): a leitura do `tenant` usa
 * `asPlatformAdmin()` de propósito. É o ovo-e-a-galinha do multi-tenant — é
 * preciso ler `tenant` antes de saber qual é o tenant — e a policy de RLS da
 * própria tabela `tenant` não permitiria descobrir o id sem esse caminho.
 * Todo o resto do contexto (sessão, membership) já passa por `forTenant()`.
 *
 * RESOLVEDOR NÃO É ACESSO AUDITADO (contrato para a F1.4): a F1.4 exige
 * `AuditLog` em todo acesso da plataforma a dado de tenant. Roteamento NÃO
 * entra nessa regra: a projeção abaixo é ESTREITA de propósito (id, slug,
 * status e campos de tema/identificação) e não passa pelo caminho auditado.
 * Auditar cada requisição encheria o log de linha inútil e destruiria o que ele
 * existe para fazer — rastrear suporte olhando dado de cliente. Quem consulta
 * dado de negócio do tenant via `asPlatformAdmin()` é que deve auditar.
 */

/**
 * Projeção mínima do tenant que o roteamento pode ver sem auditoria. Não
 * acrescente campos de negócio aqui: se a página precisa deles, leia via
 * `forTenant()` (RLS) ou pelo caminho auditado da F1.4.
 */
export const TENANT_ROUTING_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  timezone: true,
  logoUrl: true,
  // O endereço entra na projeção de roteamento porque o portal o exibe no
  // cabeçalho, junto do nome — buscá-lo à parte custaria uma consulta a mais
  // em toda página do portal.
  address: true,
  colorPrimary: true,
  colorSecondary: true,
  colorBackground: true,
  themePreset: true,
} satisfies Prisma.TenantSelect;

export type TenantRoutingInfo = Prisma.TenantGetPayload<{
  select: typeof TENANT_ROUTING_SELECT;
}>;

export type TenantContextSource = TenantResolutionSource | 'session';

export type TenantUnavailableReason = 'missing' | 'not_found' | 'suspended' | 'inactive';

export type TenantLookup =
  | { ok: true; tenant: TenantRoutingInfo; source: TenantContextSource }
  | { ok: false; reason: TenantUnavailableReason; tenant: TenantRoutingInfo | null };

export class TenantUnavailableError extends Error {
  readonly code: TenantUnavailableReason;
  readonly tenant: TenantRoutingInfo | null;
  readonly status: number;

  constructor(reason: TenantUnavailableReason, tenant: TenantRoutingInfo | null = null) {
    super(tenantUnavailableMessage(reason));
    this.name = 'TenantUnavailableError';
    this.code = reason;
    this.tenant = tenant;
    this.status = tenantUnavailableStatus(reason);
  }
}

function tenantUnavailableStatus(reason: TenantUnavailableReason): number {
  switch (reason) {
    case 'missing':
    case 'not_found':
      return 404;
    case 'suspended':
      return 403;
    case 'inactive':
      return 410;
  }
}

function tenantUnavailableMessage(reason: TenantUnavailableReason): string {
  switch (reason) {
    case 'missing':
      return 'Nenhum estabelecimento foi identificado nesta requisição.';
    case 'not_found':
      return 'Estabelecimento não encontrado.';
    case 'suspended':
      return 'Este estabelecimento está temporariamente suspenso.';
    case 'inactive':
      return 'Este estabelecimento encerrou as atividades na plataforma.';
  }
}

/**
 * `PAST_DUE` é suspensão graciosa (F7): o portal continua de pé e o bloqueio de
 * novos agendamentos é responsabilidade do domínio, não do roteamento.
 */
function statusReason(status: TenantStatus): 'suspended' | 'inactive' | null {
  if (status === 'SUSPENDED') return 'suspended';
  if (status === 'CANCELED') return 'inactive';
  return null;
}

function finalize(
  tenant: TenantRoutingInfo,
  source: TenantContextSource,
): TenantLookup {
  const reason = statusReason(tenant.status);
  if (reason) return { ok: false, reason, tenant };
  return { ok: true, tenant, source };
}

function hostnameOf(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? host : host.slice(0, end + 1);
  }
  const colon = host.lastIndexOf(':');
  return colon === -1 ? host : host.slice(0, colon);
}

async function findTenantBySlug(slug: string): Promise<TenantRoutingInfo | null> {
  return asPlatformAdmin((tx) =>
    tx.tenant.findUnique({ where: { slug }, select: TENANT_ROUTING_SELECT }),
  );
}

/**
 * `Tenant.customDomain` deve ser gravado em minúsculas (a configuração é da
 * F2): o host que chega é normalizado para minúsculas antes da comparação, e o
 * fallback sem porta cobre o desenvolvimento local.
 */
async function findTenantByCustomDomain(host: string): Promise<TenantRoutingInfo | null> {
  const hostname = hostnameOf(host);
  return asPlatformAdmin((tx) =>
    tx.tenant.findFirst({
      where:
        hostname === host
          ? { customDomain: host }
          : { OR: [{ customDomain: host }, { customDomain: hostname }] },
      select: TENANT_ROUTING_SELECT,
    }),
  );
}

export interface TenantResolutionInput {
  /** Host normalizado (com porta, se houver). */
  host?: string | null;
  /** Valor de `x-tenant-slug`, injetado pelo proxy. */
  headerSlug?: string | null;
  /** `params.slug` da rota `/[slug]`, quando existir. */
  routeSlug?: string | null;
  appDomain?: string;
}

/**
 * Resolve o tenant contra o banco na ordem: domínio próprio (host) →
 * subdomínio → `/[slug]`.
 *
 * Função PURA de request: recebe os identificadores por parâmetro, então é
 * testável sem `next/headers` e é reusável por `app/page.tsx` (raiz do domínio
 * próprio) e pelo layout do portal. Não memoiza; quem memoiza por requisição é
 * `getTenantContext()`.
 */
export async function resolveTenant(input: TenantResolutionInput): Promise<TenantLookup> {
  const appDomain = input.appDomain ?? getAppDomain();
  const classification = classifyHost(input.host, appDomain);

  if (classification.kind === 'custom') {
    const tenant = await findTenantByCustomDomain(classification.host);
    if (!tenant) return { ok: false, reason: 'not_found', tenant: null };
    return finalize(tenant, 'custom-domain');
  }

  const candidate =
    classification.kind === 'subdomain'
      ? classification.slug
      : (input.routeSlug ?? input.headerSlug ?? null);

  if (!candidate) return { ok: false, reason: 'missing', tenant: null };

  const slug = normalizeSlug(candidate);
  if (!isSlugFormat(slug) || isReservedSlug(slug)) {
    // Slug reservado nunca é tenant: é rota estática da plataforma.
    return { ok: false, reason: 'not_found', tenant: null };
  }

  const tenant = await findTenantBySlug(slug);
  if (!tenant) return { ok: false, reason: 'not_found', tenant: null };
  return finalize(tenant, classification.kind === 'subdomain' ? 'subdomain' : 'path');
}

/** Resolve pelo id — usado quando o tenant ativo vem da sessão (rotas /painel). */
export async function resolveTenantById(tenantId: string): Promise<TenantLookup> {
  const tenant = await asPlatformAdmin((tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: TENANT_ROUTING_SELECT }),
  );
  if (!tenant) return { ok: false, reason: 'not_found', tenant: null };
  return finalize(tenant, 'session');
}

/**
 * Tenant da requisição atual, memoizado por render/request.
 *
 * `routeSlug` é o `params.slug` da rota `/[slug]`; em condições normais o proxy
 * já injetou `x-tenant-slug` e ele nem é necessário — o parâmetro existe como
 * defesa para quando a página é renderizada sem passar pelo proxy (testes,
 * chamadas internas).
 */
export const getTenantContext = cache(async (routeSlug?: string): Promise<TenantLookup> => {
  const headerList = await headers();
  return resolveTenant({
    host:
      headerList.get(TENANT_HOST_HEADER) ??
      headerList.get('x-forwarded-host') ??
      headerList.get('host'),
    headerSlug: headerList.get(TENANT_SLUG_HEADER),
    routeSlug: routeSlug ?? null,
  });
});

export interface TenantContext {
  tenant: TenantRoutingInfo;
  source: TenantContextSource;
  /**
   * Executa a callback no client escopado DESTE tenant. É o único caminho de
   * acesso a dado de negócio: nada de importar PrismaClient cru, nada de
   * passar tenantId solto.
   */
  forTenant<T>(
    fn: (tx: TenantTransaction) => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T>;
}

export function toTenantContext(lookup: Extract<TenantLookup, { ok: true }>): TenantContext {
  return {
    tenant: lookup.tenant,
    source: lookup.source,
    forTenant<T>(fn: (tx: TenantTransaction) => Promise<T>, options?: TransactionOptions) {
      return runForTenant(lookup.tenant.id, fn, options);
    },
  };
}

/**
 * Igual a `getTenantContext()`, mas lança `TenantUnavailableError` em vez de
 * devolver o resultado discriminado. Use em server actions/route handlers, onde
 * a ausência de tenant é erro; use `getTenantContext()` em páginas que
 * renderizam uma experiência própria para cada motivo.
 */
export async function requireTenantContext(routeSlug?: string): Promise<TenantContext> {
  const lookup = await getTenantContext(routeSlug);
  if (!lookup.ok) throw new TenantUnavailableError(lookup.reason, lookup.tenant);
  return toTenantContext(lookup);
}

/**
 * Ids de todos os tenants ativos no sistema.
 *
 * Existe para os trabalhos periódicos (expiração de holds na F3.2, envio de
 * lembretes na F6.0): um cron não tem tenant no caminho, mas precisa varrer
 * todos. Concentrar a travessia aqui evita que cada cron novo peça a própria
 * exceção à regra de lint do `asPlatformAdmin` — a lista de exceções cresceria
 * a cada feature, que é exatamente o padrão que recusamos em RESERVED_SLUGS.
 *
 * Devolve apenas ids: quem precisa de dado de negócio abre `forTenant` e passa
 * pela RLS, tenant a tenant.
 *
 * Não é auditado, pelo mesmo critério do resolvedor de rota: não há usuário por
 * trás de um cron, e auditoria existe para rastrear pessoa olhando dado.
 */
export async function listAllTenantIds(): Promise<string[]> {
  const rows = await asPlatformAdmin((tx) => tx.tenant.findMany({ select: { id: true } }));
  return rows.map((row) => row.id);
}
