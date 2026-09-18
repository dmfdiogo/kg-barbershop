'use server';

import { cookies, headers } from 'next/headers';
import { TenantUnavailableError, requireTenantContext } from '@/lib/tenant/context';
import {
  OTP_PENDING_COOKIE_NAME,
  OTP_PENDING_COOKIE_OPTIONS,
  clientIpFromHeaders,
  decodePendingIdentity,
  encodePendingIdentity,
  parseRequestOtpInput,
  requestOtp,
  verifyOtp,
} from './otp';
import { destroySession, establishSession } from './session';
import type {
  RequestOtpInput,
  RequestOtpResult,
  VerifyOtpInput,
  VerifyOtpResult,
} from './types';

/**
 * Server actions de autenticação: a superfície que a F1.2 consome.
 *
 * A assinatura é a da F1.0 e NÃO muda (a F1.2 compila contra ela). O corpo é
 * F1.1 e delega o núcleo para `lib/auth/otp.ts`; aqui ficam só as coisas que
 * dependem do runtime do Next:
 *
 *   - resolver o tenant por `requireTenantContext()` (nunca por parâmetro vindo
 *     do cliente) e traduzir indisponibilidade para `TENANT_UNAVAILABLE`;
 *   - ler IP do request para o rate limit;
 *   - guardar/limpar o nome pendente do primeiro acesso (cookie assinado e
 *     httpOnly) — `OtpChallenge` não tem coluna de nome e `VerifyOtpInput` não
 *     carrega nome (contrato congelado);
 *   - `establishSession` no verify, devolvendo o papel LIDO DO BANCO.
 */

async function tenantContextOrUnavailable(): Promise<
  { ok: true; tenantId: string } | { ok: false; error: TenantUnavailableError }
> {
  try {
    const context = await requireTenantContext();
    return { ok: true, tenantId: context.tenant.id };
  } catch (error) {
    if (error instanceof TenantUnavailableError) return { ok: false, error };
    throw error;
  }
}

export async function requestOtpAction(input: RequestOtpInput): Promise<RequestOtpResult> {
  const parsed = parseRequestOtpInput(input);
  if (!parsed.ok) return parsed;

  const tenant = await tenantContextOrUnavailable();
  if (!tenant.ok) {
    return { ok: false, code: 'TENANT_UNAVAILABLE', message: tenant.error.message };
  }

  const headerList = await headers();
  const result = await requestOtp({
    tenantId: tenant.tenantId,
    name: parsed.name,
    phone: parsed.phone,
    ip: clientIpFromHeaders(headerList),
  });

  if (result.ok) {
    const store = await cookies();
    store.set(
      OTP_PENDING_COOKIE_NAME,
      encodePendingIdentity(parsed.phone, parsed.name),
      OTP_PENDING_COOKIE_OPTIONS,
    );
  }

  return result;
}

export async function verifyOtpAction(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  const tenant = await tenantContextOrUnavailable();
  if (!tenant.ok) {
    return { ok: false, code: 'TENANT_UNAVAILABLE', message: tenant.error.message };
  }

  const phone = typeof input?.phone === 'string' ? input.phone.trim() : '';
  const store = await cookies();
  const pending = decodePendingIdentity(store.get(OTP_PENDING_COOKIE_NAME)?.value);
  const pendingName = pending && pending.phone === phone ? pending.name : null;

  const headerList = await headers();
  const result = await verifyOtp({
    tenantId: tenant.tenantId,
    phone,
    code: input?.code,
    pendingName,
    ip: clientIpFromHeaders(headerList),
  });

  if (!result.ok) return result;

  // A sessão carrega só userId + tenant ativo; o papel volta do banco e o
  // `requireRole` da F1.0 relê `TenantMember` a cada requisição.
  await establishSession(result.userId, tenant.tenantId);
  store.delete(OTP_PENDING_COOKIE_NAME);

  return { ok: true, role: result.role };
}

/** Encerra a sessão atual. Já funcional: não depende do OTP. */
export async function logoutAction(): Promise<void> {
  await destroySession();
}
