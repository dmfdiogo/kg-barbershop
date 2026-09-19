'use server';

import { revalidatePath } from 'next/cache';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import {
  cancelMembership,
  listCustomerMemberships,
  type MembershipErrorCode,
} from '@/lib/membership/subscription';
import {
  requireTenantContext,
  TenantUnavailableError,
  type TenantContext,
} from '@/lib/tenant/context';
import type { ClubActionErrorCode, ClubActionResult } from './_lib/types';

/**
 * Cancelamento do clube pelo cliente (tarefa F5.3).
 *
 * A action é a casca fina: resolve o tenant da requisição (nunca por parâmetro),
 * prova a identidade pela sessão + `TenantMember` e confirma que a assinatura
 * pedida é DAQUELE cliente antes de chamar o domínio. O `memberId` e o tenant
 * vêm do banco, jamais do corpo da requisição — é isso que impede um cliente
 * cancelar a assinatura de outro no mesmo salão.
 *
 * Reimplementar a regra de cancelamento aqui seria violar o "NÃO FAÇA": quem
 * decide preço, ciclo de vida, política de crédito e chamada ao provedor é
 * `cancelMembership` (F5.1). Esta action só autoriza e invalida o cache.
 */

const CLUB_PATH = '/clube';

function fail(code: ClubActionErrorCode, message: string): ClubActionResult {
  return { ok: false, code, message };
}

function mapErrorCode(code: MembershipErrorCode): ClubActionErrorCode {
  switch (code) {
    case 'MEMBERSHIP_NOT_FOUND':
      return 'MEMBERSHIP_NOT_FOUND';
    case 'FORBIDDEN':
      return 'FORBIDDEN';
    case 'PROVIDER_ERROR':
    case 'PERSISTENCE_FAILED':
      return 'PROVIDER_ERROR';
    default:
      return 'ERROR';
  }
}

export async function cancelClubMembershipAction(input: {
  membershipId: string;
}): Promise<ClubActionResult> {
  const membershipId =
    typeof input?.membershipId === 'string' ? input.membershipId.trim() : '';
  if (!membershipId) return fail('INVALID_INPUT', 'Assinatura inválida.');

  let ctx: TenantContext;
  try {
    ctx = await requireTenantContext();
  } catch (error) {
    if (error instanceof TenantUnavailableError) {
      return fail('TENANT_UNAVAILABLE', error.message);
    }
    throw error;
  }

  const session = await getSession();
  if (!session) return fail('UNAUTHENTICATED', 'Entre para gerenciar o seu clube.');

  const member = await getMembership(ctx.tenant.id, session.userId);
  if (!member) return fail('UNAUTHENTICATED', 'Entre para gerenciar o seu clube.');

  // Posse confirmada ANTES de qualquer efeito: a assinatura tem de estar entre
  // as do cliente logado. Nada de confiar no id que chegou do navegador.
  const owned = await ctx.forTenant((tx) =>
    listCustomerMemberships(tx, ctx.tenant.id, member.id),
  );
  if (!owned.some((membership) => membership.id === membershipId)) {
    return fail('FORBIDDEN', 'Esta assinatura não é sua.');
  }

  const result = await cancelMembership({
    tenantId: ctx.tenant.id,
    membershipId,
    actor: { kind: 'CUSTOMER', memberId: member.id },
  });
  if (!result.ok) return fail(mapErrorCode(result.code), result.message);

  revalidatePath(`/${ctx.tenant.slug}${CLUB_PATH}`);
  revalidatePath(CLUB_PATH);
  return { ok: true };
}
