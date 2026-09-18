import { cookies } from 'next/headers';
import {
  OTP_PENDING_COOKIE_NAME,
  OTP_PENDING_COOKIE_OPTIONS,
  clientIpFromHeaders,
  encodePendingIdentity,
  parseRequestOtpInput,
  requestOtp,
} from '@/lib/auth/otp';
import type { RequestOtpErrorCode, RequestOtpResult } from '@/lib/auth/types';
import { jsonResult, stringField, tenantIdOrResponse } from '../_shared';

/**
 * Pedido de código OTP (F1.1): `POST /api/auth/otp` com `{ name, phone }`.
 *
 * A resposta é a mesma para telefone que existe e que não existe — o núcleo nem
 * consulta `User`, então não há canal de enumeração. O tenant vem do
 * host/slug resolvido pela F1.0, nunca do corpo.
 */

function statusFor(code: RequestOtpErrorCode): number {
  switch (code) {
    case 'INVALID_INPUT':
    case 'INVALID_PHONE':
      return 400;
    case 'COOLDOWN':
    case 'RATE_LIMITED':
      return 429;
    case 'TENANT_UNAVAILABLE':
      return 403;
  }
}

function retryAfterHeaders(result: Extract<RequestOtpResult, { ok: false }>): HeadersInit | undefined {
  return result.retryAfterSeconds === undefined
    ? undefined
    : { 'retry-after': String(result.retryAfterSeconds) };
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = parseRequestOtpInput({
    name: stringField(body, 'name'),
    phone: stringField(body, 'phone'),
  });
  if (!parsed.ok) return jsonResult(parsed, 400);

  const tenant = await tenantIdOrResponse();
  if (!tenant.ok) return tenant.response;

  const result = await requestOtp({
    tenantId: tenant.tenantId,
    name: parsed.name,
    phone: parsed.phone,
    ip: clientIpFromHeaders(request.headers),
  });

  if (!result.ok) return jsonResult(result, statusFor(result.code), retryAfterHeaders(result));

  const store = await cookies();
  store.set(
    OTP_PENDING_COOKIE_NAME,
    encodePendingIdentity(parsed.phone, parsed.name),
    OTP_PENDING_COOKIE_OPTIONS,
  );

  return jsonResult(result);
}
