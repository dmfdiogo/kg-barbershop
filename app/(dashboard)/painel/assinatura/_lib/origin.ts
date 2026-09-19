import { getAppDomain } from '@/lib/tenant/slugs';

/**
 * Origem absoluta para as URLs de retorno do provedor de cobrança.
 *
 * VEM DA CONFIGURAÇÃO, NUNCA DO HEADER DA REQUISIÇÃO. A primeira versão desta
 * função montava a origem a partir de `Host`/`x-forwarded-host`, como os
 * webhooks fazem. Para uma URL de retorno isso é uma porta aberta: quem
 * controlar o header faz o `successUrl` apontar para outro domínio, e o
 * provedor manda o dono para lá DEPOIS de ele pagar — open redirect no fim do
 * fluxo de pagamento, com o usuário já predisposto a confiar no que vê.
 *
 * O painel do estabelecimento mora sempre no domínio da plataforma
 * (`APP_DOMAIN`), que já é obrigatório em produção — `getAppDomain()` falha
 * fechado se faltar, em vez de adivinhar. Domínio próprio de tenant não entra
 * aqui: ele serve o portal público, não o painel.
 *
 * A diferença em relação aos webhooks é intencional. Lá a origem só compõe uma
 * URL que a própria aplicação vai chamar de volta; aqui ela vira destino de
 * redirecionamento para um humano autenticado.
 */
export function requestOrigin(): string | null {
  try {
    const domain = getAppDomain();
    if (!domain) return null;
    const protocol = domain.startsWith('localhost') || domain.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
    return `${protocol}://${domain}`;
  } catch {
    // `getAppDomain()` lança em produção sem configuração. A action traduz o
    // null em erro de fluxo; melhor recusar do que redirecionar para um lugar
    // que não sabemos qual é.
    return null;
  }
}

/** Junta uma origem absoluta e um caminho; pura para ser testável. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}
