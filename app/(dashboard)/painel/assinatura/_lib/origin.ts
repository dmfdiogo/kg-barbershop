import { headers } from 'next/headers';

/**
 * Origem absoluta da requisição em curso.
 *
 * O `BillingProvider` exige `successUrl`/`cancelUrl`/`returnUrl` ABSOLUTAS — o
 * mock recusa URL relativa com o mesmo `VALIDATION` que o Stripe devolveria. A
 * resolução é a mesma já usada pelos webhooks (`lib/billing/webhook.ts`,
 * `lib/payments/webhook.ts`): host da requisição + protocolo de
 * `x-forwarded-proto`, caindo para `http` só em desenvolvimento. Nenhuma
 * variável de ambiente nova é inventada.
 *
 * Fora de request scope (testes puros, cron) devolve `null`; a action traduz
 * isso em erro de fluxo em vez de montar uma URL relativa que o provedor
 * recusaria.
 */
export async function requestOrigin(): Promise<string | null> {
  try {
    const headerList = await headers();
    const host = headerList.get('host') ?? headerList.get('x-forwarded-host');
    if (!host) return null;
    const protocol =
      headerList.get('x-forwarded-proto') ??
      (process.env.NODE_ENV === 'development' ? 'http' : 'https');
    return `${protocol}://${host}`;
  } catch {
    return null;
  }
}

/** Junta uma origem absoluta e um caminho; pura para ser testável. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}
