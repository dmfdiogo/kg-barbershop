import { isDevConsoleEnabled, notFoundResponse } from '../../guard';

/** Bloqueio server-side de todas as actions do console de billing (`contexto-comum.md` §5.4). */
export function guardDevAction(): Response | null {
  return isDevConsoleEnabled() ? null : notFoundResponse();
}

export function redirectToBillingConsole(params: Record<string, string>): Response {
  const query = new URLSearchParams(params);
  return new Response(null, {
    status: 303,
    headers: { location: `/dev/billing?${query.toString()}` },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
