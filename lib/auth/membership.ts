import type { TenantMember } from '@prisma/client';
import {
  TENANT_ROUTING_SELECT,
  TenantUnavailableError,
  resolveTenantById,
  type TenantRoutingInfo,
} from '@/lib/tenant/context';
import { asPlatformAdmin, forTenant } from '@/lib/tenant/db';
import { postgresErrorCode } from '@/lib/tenant/errors';
import { getSession, setActiveTenant } from './session';
import type { Role, Session } from './types';

/**
 * Membership: o vínculo (usuário, tenant) da F1.3.
 *
 * Decisão de identidade (plano-refatoracao.md §4): `User` é global — a pessoa
 * faz OTP uma vez e reencontra seus agendamentos em qualquer salão — e o papel
 * pertence ao par (usuário, tenant), guardado em `TenantMember`. Este módulo
 * materializa três consequências dessa decisão:
 *
 *   1. Primeiro acesso ao portal de um tenant provisiona `TenantMember` com
 *      papel CUSTOMER (`ensureMembership`), sem tocar em vínculos de outros
 *      tenants nem rebaixar papel já existente.
 *   2. A mesma pessoa pode ter papéis diferentes em tenants diferentes; a troca
 *      de contexto (`switchActiveTenant`) muda só o tenant ativo da sessão,
 *      nunca o papel.
 *   3. Papel é lido do banco a cada requisição (`getMembership` e o
 *      `requireRole` da F1.0) — jamais gravado no cookie assinado.
 *
 * ISOLAMENTO (contexto-comum.md §4): a pergunta "este telefone existe em outro
 * salão?" não tem resposta a partir de um tenant. Toda leitura/escrita de
 * vínculo passa pelo client escopado (`forTenant`), então a RLS responde vazio
 * para qualquer linha de outro tenant. A única travessia entre tenants é
 * `listMyMemberships()`, que não aceita `userId` por parâmetro: só devolve os
 * vínculos da própria sessão. `ensureMembership`/`getMembership` aceitam um
 * `userId` explícito de propósito (o OTP precisa provisionar antes de existir
 * sessão), mas são escopados por tenant e a RLS impede que enxerguem o vínculo
 * de outro; o `userId` NUNCA pode vir de input de requisição — só de identidade
 * já provada (sessão ou verificação de OTP).
 */

export type MembershipErrorCode = 'NO_SESSION' | 'NOT_A_MEMBER';

/**
 * Erro de vínculo. Separa "não tem sessão" (401) de "tem sessão e não pertence
 * a este tenant" (403), o mesmo contrato do `AuthError` da F1.0.
 */
export class MembershipError extends Error {
  readonly code: MembershipErrorCode;
  readonly status: number;

  constructor(code: MembershipErrorCode, message: string) {
    super(message);
    this.name = 'MembershipError';
    this.code = code;
    this.status = code === 'NO_SESSION' ? 401 : 403;
  }
}

/** Papel criado no primeiro acesso. Papel é decisão de domínio; a constante evita string solta. */
const DEFAULT_MEMBER_ROLE: Role = 'CUSTOMER';

/** 23505 = unique_violation; P2002 é o mesmo erro embrulhado pelo Prisma. */
const UNIQUE_VIOLATION = '23505';
const PRISMA_UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code === UNIQUE_VIOLATION || code === PRISMA_UNIQUE_VIOLATION;
}

/**
 * O vínculo da pessoa com o tenant, lido sob a RLS daquele tenant. Devolve
 * `null` quando não existe — inclusive quando o vínculo existe em OUTRO tenant,
 * que é exatamente a resposta que o isolamento exige.
 */
export async function getMembership(tenantId: string, userId: string): Promise<TenantMember | null> {
  return forTenant(tenantId, (tx) =>
    tx.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    }),
  );
}

/**
 * Provisiona o `TenantMember` com papel CUSTOMER no primeiro acesso da pessoa
 * ao portal do tenant e devolve o vínculo — existente ou recém-criado.
 *
 * Idempotente: chamar de novo devolve a mesma linha. Papel preexistente (OWNER,
 * STAFF) é preservado, nunca rebaixado. Duas primeiras visitas simultâneas
 * disputam o índice único `(tenant_id, user_id)`; quem perde a corrida relê a
 * linha do vencedor. A releitura é uma transação nova de propósito: a violação
 * de unicidade aborta a transação corrente, então não dá para capturá-la e
 * continuar dentro da mesma callback.
 *
 * PRECONDIÇÃO: `userId` vem de identidade provada (sessão ou OTP verificado) e
 * `tenantId` do tenant resolvido da requisição — nunca de input do cliente.
 */
export async function ensureMembership(tenantId: string, userId: string): Promise<TenantMember> {
  if (!tenantId || !userId) {
    throw new TypeError('ensureMembership exige tenantId e userId.');
  }

  try {
    return await forTenant(tenantId, async (tx) => {
      const existing = await tx.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
      });
      if (existing) return existing;

      return tx.tenantMember.create({
        data: { tenantId, userId, role: DEFAULT_MEMBER_ROLE },
      });
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const raced = await getMembership(tenantId, userId);
    if (raced) return raced;
    throw error;
  }
}

export interface MembershipSummary {
  tenant: TenantRoutingInfo;
  role: Role;
}

/**
 * A travessia entre tenants é inevitável: "meus estabelecimentos" não tem
 * tenant no caminho. Ela usa `asPlatformAdmin()` com a projeção ESTREITA do
 * roteamento, pelo mesmo motivo do resolvedor de tenant (lib/tenant/context.ts):
 * identidade e roteamento não são acesso de plataforma a dado de negócio e não
 * entram na auditoria da F1.4.
 *
 * O filtro é SEMPRE o `userId` da própria sessão e a função não aceita `userId`
 * por parâmetro: não existe caminho para um salão perguntar pelos vínculos de
 * outra pessoa. `TenantMember` + RLS continuam sendo o caminho para todo dado
 * de negócio.
 */
export async function listMyMemberships(): Promise<MembershipSummary[]> {
  const session = await getSession();
  if (!session) {
    throw new MembershipError('NO_SESSION', 'Entre para continuar.');
  }

  return asPlatformAdmin(async (tx) => {
    const members = await tx.tenantMember.findMany({
      where: { userId: session.userId },
      select: { role: true, tenant: { select: TENANT_ROUTING_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => ({ tenant: member.tenant, role: member.role }));
  });
}

/**
 * Troca o tenant ativo da sessão para um tenant em que a pessoa já é membro.
 *
 * Diferente de `setActiveTenant()` de `session.ts` (o primitivo que só regrava
 * o cookie), esta função valida as duas condições do produto antes de trocar:
 * o tenant existe e está no ar, e a pessoa tem `TenantMember` nele. Não
 * provisiona vínculo: entrar num salão novo é o fluxo de OTP/primeiro acesso
 * (`ensureMembership`), não um efeito colateral da troca.
 *
 * O papel não muda com a troca porque nunca esteve na sessão: quem o lê é
 * `requireRole`, a cada requisição, do `TenantMember` do tenant ativo.
 */
export async function switchActiveTenant(tenantId: string): Promise<Session> {
  const session = await getSession();
  if (!session) {
    throw new MembershipError('NO_SESSION', 'Entre para continuar.');
  }

  const lookup = await resolveTenantById(tenantId);
  if (!lookup.ok) {
    throw new TenantUnavailableError(lookup.reason, lookup.tenant);
  }

  const member = await getMembership(tenantId, session.userId);
  if (!member) {
    throw new MembershipError('NOT_A_MEMBER', 'Você não tem acesso a este estabelecimento.');
  }

  return setActiveTenant(tenantId);
}
