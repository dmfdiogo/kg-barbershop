import { cache } from 'react';
import type { TenantMember, User } from '@prisma/client';
import { asPlatformAdmin } from '@/lib/tenant/db';
import {
  TenantUnavailableError,
  getTenantContext,
  resolveTenantById,
  toTenantContext,
  type TenantContext,
  type TenantLookup,
} from '@/lib/tenant/context';
import { getSession } from './session';
import type { Role, Session } from './types';

/**
 * RBAC da F1.0: `requireRole(...)` para Server Components e Route Handlers.
 *
 * REGRA CRÍTICA: o papel NÃO mora no token. Depois de resolver o tenant da
 * requisição, o papel é lido de `TenantMember` para AQUELE tenant. A mesma
 * pessoa pode ser OWNER no salão A e CUSTOMER no salão B, e cada sessão enxerga
 * só o seu.
 *
 * O contexto inteiro é memoizado por requisição (`cache()`), então vários
 * componentes podem chamar `requireRole` sem repetir as queries.
 */

/**
 * Hierarquia de papéis: OWNER > STAFF > CUSTOMER. `requireRole('STAFF')` aceita
 * STAFF e OWNER (dono também atende); `requireRole('OWNER')` aceita só OWNER.
 */
export const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  STAFF: 1,
  OWNER: 2,
};

export function roleSatisfies(role: Role, allowed: readonly Role[]): boolean {
  if (allowed.length === 0) return true;
  const minRank = Math.min(...allowed.map((candidate) => ROLE_RANK[candidate]));
  return ROLE_RANK[role] >= minRank;
}

export interface RequestContext extends TenantContext {
  session: Session;
  user: User;
  member: TenantMember;
  role: Role;
  /** Dá acesso a `(platform)`, sempre pelo caminho auditado da F1.4. */
  isSuperAdmin: boolean;
}

export type AuthErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN';

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly status: number;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = code === 'UNAUTHENTICATED' ? 401 : 403;
  }

  toResponse(): Response {
    return Response.json({ error: this.code, message: this.message }, { status: this.status });
  }
}

/**
 * Resultado da autenticação: distingue "não tem sessão" (401) de "tem sessão e
 * não pode este tenant" (403). A distinção importa para a UX: 401 para quem já
 * está logado vira laço de login. O portal é público, então esconder a
 * existência do estabelecimento não é objetivo — o catálogo já é público.
 */
export type AuthLookup =
  | { ok: true; context: RequestContext }
  | { ok: false; reason: 'unauthenticated' | 'forbidden' };

/**
 * Contexto autenticado da requisição, memoizado.
 *
 * Resolução do tenant, em ordem:
 *   1. host/path da requisição (domínio próprio → subdomínio → `/[slug]`);
 *   2. se não há candidato nenhum no request (ex.: `/painel`), o tenant ativo
 *      da sessão — é o que permite a troca de contexto entre tenants (F1.3).
 *
 * Um tenant resolvido mas indisponível (inexistente, suspenso, inativo) lança
 * `TenantUnavailableError`: a página errada não deve renderizar nem para quem
 * tem sessão.
 */
export const getAuthLookup = cache(async (routeSlug?: string): Promise<AuthLookup> => {
  const session = await getSession();
  if (!session) return { ok: false, reason: 'unauthenticated' };

  const lookup = await getTenantContext(routeSlug);

  let resolved: TenantLookup;
  if (lookup.ok) {
    resolved = lookup;
  } else if (lookup.reason !== 'missing') {
    throw new TenantUnavailableError(lookup.reason, lookup.tenant);
  } else if (!session.activeTenantId) {
    // Autenticado, mas sem tenant ativo para esta rota (ex.: /painel antes de
    // escolher o salão). Não é "não autenticado" — é acesso sem contexto.
    return { ok: false, reason: 'forbidden' };
  } else {
    resolved = await resolveTenantById(session.activeTenantId);
  }

  if (!resolved.ok) {
    throw new TenantUnavailableError(resolved.reason, resolved.tenant);
  }

  const tenantContext = toTenantContext(resolved);

  // `user` é global (sem RLS) e não é dado de tenant: leitura pontual por id,
  // nunca listagem. O membership, sim, passa pelo client escopado.
  const user = await asPlatformAdmin((tx) =>
    tx.user.findUnique({ where: { id: session.userId } }),
  );
  if (!user) return { ok: false, reason: 'unauthenticated' };

  const member = await tenantContext.forTenant((tx) =>
    tx.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: tenantContext.tenant.id, userId: user.id } },
    }),
  );
  if (!member) return { ok: false, reason: 'forbidden' };

  return {
    ok: true,
    context: {
      ...tenantContext,
      session,
      user,
      member,
      role: member.role,
      isSuperAdmin: user.isSuperAdmin,
    },
  };
});

/**
 * Atalho que devolve `null` em vez de discriminar. Útil em telas que renderizam
 * estados diferentes para visitante e membro; para autorização, prefira
 * `requireRole`, que preserva o 401 × 403.
 */
export async function getAuthContext(routeSlug?: string): Promise<RequestContext | null> {
  const lookup = await getAuthLookup(routeSlug);
  return lookup.ok ? lookup.context : null;
}

/**
 * Exige sessão e um dos papéis. Para Server Components é só `await`; a negação
 * lança `AuthError` (F1.2/F2 decidem a apresentação com um error boundary).
 * Para Route Handlers, prefira `withRole`, que converte o erro em resposta.
 *
 * Sem argumentos, exige apenas estar autenticado como membro do tenant.
 * Sem sessão → 401 (`UNAUTHENTICATED`); sessão sem membership/papel no tenant →
 * 403 (`FORBIDDEN`).
 */
export async function requireRole(...roles: Role[]): Promise<RequestContext> {
  const lookup = await getAuthLookup();
  if (!lookup.ok) {
    throw lookup.reason === 'unauthenticated'
      ? new AuthError('UNAUTHENTICATED', 'Entre para continuar.')
      : new AuthError('FORBIDDEN', 'Você não tem acesso a esta área.');
  }
  if (!roleSatisfies(lookup.context.role, roles)) {
    throw new AuthError('FORBIDDEN', 'Você não tem acesso a esta área.');
  }
  return lookup.context;
}

export type RouteHandler = (
  context: RequestContext,
  request: Request,
) => Promise<Response> | Response;

/**
 * Wrapper de Route Handler: resolve o contexto, chama o handler e traduz
 * `AuthError`/`TenantUnavailableError` em resposta JSON com o status certo
 * (401/403/404/410). Erro inesperado continua subindo para o runtime.
 */
export function withRole(
  roles: readonly Role[],
  handler: RouteHandler,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    try {
      const context = await requireRole(...roles);
      return await handler(context, request);
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError || error instanceof TenantUnavailableError) {
    return Response.json({ error: error.code, message: error.message }, { status: error.status });
  }
  throw error;
}

export interface SuperAdminContext {
  session: Session;
  user: User;
}

/**
 * Portão do Super Admin (F1.4): autentica e confere `User.isSuperAdmin`.
 *
 * Este helper NÃO dá acesso a dado de tenant. Acesso de plataforma a dado de
 * tenant continua sendo, obrigatoriamente, por `asPlatformAdmin()` no caminho
 * auditado da F1.4 — este helper não audita nem deve ser usado como atalho.
 */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const session = await getSession();
  if (!session) throw new AuthError('UNAUTHENTICATED', 'Entre para continuar.');

  const user = await asPlatformAdmin((tx) =>
    tx.user.findUnique({ where: { id: session.userId } }),
  );
  // Sessão apontando para usuário inexistente é sessão inválida (401), não
  // falta de permissão.
  if (!user) throw new AuthError('UNAUTHENTICATED', 'Entre para continuar.');
  if (!user.isSuperAdmin) {
    throw new AuthError('FORBIDDEN', 'Área restrita da plataforma.');
  }
  return { session, user };
}
