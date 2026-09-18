import { cookies } from 'next/headers';
import { establishSession } from '@/lib/auth/session';
import {
  OTP_PENDING_COOKIE_NAME,
  clientIpFromHeaders,
  decodePendingIdentity,
  verifyOtp,
} from '@/lib/auth/otp';
import type { VerifyOtpErrorCode } from '@/lib/auth/types';
import { jsonResult, stringField, tenantIdOrResponse } from '../../_shared';

/**
 * Verificação do código OTP (F1.1): `POST /api/auth/otp/verify` com
 * `{ phone, code }`.
 *
 * Em caso de sucesso cria a sessão com `establishSession` (F1.0) e devolve o
 * papel lido de `TenantMember` — nunca de token. O nome do primeiro acesso vem
 * do cookie pendente setado pelo pedido de código; cookie ausente só degrada o
 * nome (o cadastro continua), e o papel é o que vale.
 */

function statusFor(code: VerifyOtpErrorCode): number {
  switch (code) {
    case 'INVALID_CODE':
    case 'EXPIRED':
      return 400;
    case 'TOO_MANY_ATTEMPTS':
    case 'RATE_LIMITED':
      return 429;
    case 'TENANT_UNAVAILABLE':
      return 403;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const phone = stringField(body, 'phone');
  const code = stringField(body, 'code');

  const tenant = await tenantIdOrResponse();
  if (!tenant.ok) return tenant.response;

  const store = await cookies();
  const pending = decodePendingIdentity(store.get(OTP_PENDING_COOKIE_NAME)?.value);
  const pendingName = pending && pending.phone === phone ? pending.name : null;

  const result = await verifyOtp({
    tenantId: tenant.tenantId,
    phone,
    code,
    pendingName,
    ip: clientIpFromHeaders(request.headers),
  });

  if (!result.ok) return jsonResult(result, statusFor(result.code));

  await establishSession(result.userId, tenant.tenantId);
  store.delete(OTP_PENDING_COOKIE_NAME);

  return jsonResult({ ok: true, role: result.role });
}
