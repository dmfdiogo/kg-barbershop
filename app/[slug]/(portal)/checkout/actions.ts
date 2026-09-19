'use server';

import { headers } from 'next/headers';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import {
  CheckoutError,
  confirmWithCredit,
  startCheckout,
  type CardInput,
  type CheckoutErrorCode,
  type CheckoutResult,
  type CreditCheckoutResult,
} from '@/lib/payments/charge';
import { firstIpFromHeader } from '@/lib/payments/remote-ip';
import { requireTenantContext, TenantUnavailableError } from '@/lib/tenant/context';
import { readBookingSessionId } from '@/app/[slug]/(portal)/agendar/_lib/booking-session';

/**
 * Server actions do checkout (F4.2).
 *
 * Casca fina como as de `agendar`: resolvem tenant e sessão (nunca por
 * parâmetro vindo do cliente), extraem o IP do pagador do header e delegam ao
 * domínio em `lib/payments/charge.ts`. Nenhum erro de fluxo sobe como 500.
 */

export type CheckoutActionErrorCode = CheckoutErrorCode | 'TENANT_UNAVAILABLE' | 'CONFLICT';

export type CheckoutActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CheckoutActionErrorCode; message: string };

function fail(code: CheckoutActionErrorCode, message: string): CheckoutActionResult<never> {
  return { ok: false, code, message };
}

function toFailure(error: unknown): CheckoutActionResult<never> {
  if (error instanceof CheckoutError) return fail(error.code, error.message);
  if (error instanceof TenantUnavailableError) return fail('TENANT_UNAVAILABLE', error.message);
  console.error('[checkout] erro inesperado', error);
  return fail('CONFLICT', 'Não foi possível concluir o pagamento agora. Tente novamente.');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function payerRemoteIp(): Promise<string | null> {
  const headerList = await headers();
  return (
    firstIpFromHeader(headerList.get('x-forwarded-for')) ??
    firstIpFromHeader(headerList.get('x-real-ip')) ??
    firstIpFromHeader(headerList.get('cf-connecting-ip'))
  );
}

export interface StartCheckoutActionInput {
  holdId: string;
  method: 'PIX' | 'CARD';
  card?: CardInput;
}

export async function startCheckoutAction(
  input: StartCheckoutActionInput,
): Promise<CheckoutActionResult<CheckoutResult>> {
  const holdId = asString(input?.holdId);
  if (!holdId) return fail('INVALID_INPUT', 'Dados do pagamento inválidos.');
  if (input?.method !== 'PIX' && input?.method !== 'CARD') {
    return fail('INVALID_INPUT', 'Escolha Pix ou cartão.');
  }

  try {
    const [ctx, session, holdSessionId, remoteIp] = await Promise.all([
      requireTenantContext(),
      getSession(),
      readBookingSessionId(),
      payerRemoteIp(),
    ]);
    if (!session) {
      return fail('UNAUTHENTICATED', 'Confirme seu WhatsApp para concluir o pagamento.');
    }
    const member = await getMembership(ctx.tenant.id, session.userId);
    if (!member) return fail('UNAUTHENTICATED', 'Entre para concluir o pagamento.');

    const value = await startCheckout({
      ctx,
      holdId,
      memberId: member.id,
      method: input.method,
      ...(input.card ? { card: input.card } : {}),
      remoteIp,
      holdSessionId,
    });
    return { ok: true, value };
  } catch (error) {
    return toFailure(error);
  }
}

export interface ConfirmWithCreditActionInput {
  holdId: string;
}

/**
 * Confirma usando um crédito do clube. Existe como ação separada porque não é
 * um pagamento: não há forma de pagamento a escolher, nem IP de pagador a
 * extrair, e nada sai para o provedor. O `startCheckoutAction` recusa este
 * caso de propósito — cobrar quem tem crédito é o defeito que esta ação evita.
 */
export async function confirmWithCreditAction(
  input: ConfirmWithCreditActionInput,
): Promise<CheckoutActionResult<CreditCheckoutResult>> {
  const holdId = asString(input?.holdId);
  if (!holdId) return fail('INVALID_INPUT', 'Dados do agendamento inválidos.');

  try {
    const [ctx, session, holdSessionId] = await Promise.all([
      requireTenantContext(),
      getSession(),
      readBookingSessionId(),
    ]);
    if (!session) {
      return fail('UNAUTHENTICATED', 'Confirme seu WhatsApp para concluir o agendamento.');
    }
    const member = await getMembership(ctx.tenant.id, session.userId);
    if (!member) return fail('UNAUTHENTICATED', 'Entre para concluir o agendamento.');

    const value = await confirmWithCredit({ ctx, holdId, memberId: member.id, holdSessionId });
    return { ok: true, value };
  } catch (error) {
    return toFailure(error);
  }
}
