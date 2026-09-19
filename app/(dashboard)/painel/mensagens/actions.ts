'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import {
  clearMessagingOptOut,
  setMessagingOptOut,
} from '@/lib/messaging/preferences';
import { eraseCustomer } from '@/lib/privacy';

/**
 * Server actions da área de mensagens e privacidade (tarefa F6.2).
 *
 * Toda ação revalida `requireRole('OWNER')`: o portão do layout barra a
 * navegação, mas a autorização precisa valer no caminho que escreve. A regra de
 * negócio fica na camada de domínio (`lib/messaging/preferences` e
 * `lib/privacy`), que recebe a transação escopada; aqui só há casca e revalidação.
 *
 * ORIGEM DO CONSENTIMENTO: quando o dono limpa um opt-out, o ato é o
 * consentimento — fica gravado com `consentAt` e `consentSource = 'painel'`.
 * Quando ele marca o opt-out, a data de consentimento anterior é preservada
 * como histórico.
 */

const MENSAGENS_PATH = '/painel/mensagens';
const PANEL_CONSENT_SOURCE = 'painel';

export type MessagingActionResult =
  | { ok: true; purged?: boolean }
  | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND'; message: string };

async function ownerOrForbidden(): Promise<
  { ok: true; context: Awaited<ReturnType<typeof requireRole>> } | { ok: false }
> {
  try {
    return { ok: true, context: await requireRole('OWNER') };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false };
    throw error;
  }
}

function forbidden(): MessagingActionResult {
  return { ok: false, code: 'FORBIDDEN', message: 'Você não tem acesso a esta área.' };
}

export async function setMessagingOptOutAction(
  tenantMemberId: string,
  optedOut: boolean,
): Promise<MessagingActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();
  const { context } = auth;

  const member = await context.forTenant((tx) =>
    tx.tenantMember.findFirst({
      where: { id: tenantMemberId, tenantId: context.tenant.id },
      select: { userId: true },
    }),
  );
  if (!member) {
    return { ok: false, code: 'NOT_FOUND', message: 'Cliente não encontrado.' };
  }

  await context.forTenant(async (tx) => {
    if (optedOut) {
      await setMessagingOptOut(tx, {
        tenantId: context.tenant.id,
        userId: member.userId,
      });
    } else {
      await clearMessagingOptOut(tx, {
        tenantId: context.tenant.id,
        userId: member.userId,
        source: PANEL_CONSENT_SOURCE,
      });
    }
  });

  revalidatePath(MENSAGENS_PATH);
  return { ok: true };
}

export async function eraseCustomerAction(
  tenantMemberId: string,
): Promise<MessagingActionResult> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return forbidden();
  const { context } = auth;

  const result = await eraseCustomer({
    tenantId: context.tenant.id,
    tenantMemberId,
    actorId: context.user.id,
  });
  if (!result) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Cliente não encontrado ou já anonimizado.',
    };
  }

  revalidatePath(MENSAGENS_PATH);
  return { ok: true, purged: result.identityPurged };
}
