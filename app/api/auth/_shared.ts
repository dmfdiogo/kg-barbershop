import { TenantUnavailableError, requireTenantContext } from '@/lib/tenant/context';

/**
 * Helpers comuns das rotas de `/api/auth/**` (F1.1). Prefixo `_` mantém o
 * arquivo fora do roteamento, como em `app/dev/api/payments/_shared.ts`.
 */

export function jsonResult(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, status === 200 ? { headers } : { status, headers });
}

export function stringField(body: unknown, field: string): string {
  if (typeof body !== 'object' || body === null) return '';
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

/**
 * Resolve o tenant da requisição. O tenant NUNCA vem do corpo: é o host/slug
 * resolvido pela F1.0. Indisponível vira resposta com o status do contexto
 * (404/403/410), no mesmo formato dos resultados de OTP.
 */
export async function tenantIdOrResponse(): Promise<
  { ok: true; tenantId: string } | { ok: false; response: Response }
> {
  try {
    const context = await requireTenantContext();
    return { ok: true, tenantId: context.tenant.id };
  } catch (error) {
    if (error instanceof TenantUnavailableError) {
      return {
        ok: false,
        response: jsonResult(
          { ok: false, code: 'TENANT_UNAVAILABLE', message: error.message },
          error.status,
        ),
      };
    }
    throw error;
  }
}
