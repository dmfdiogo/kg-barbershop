import type { Role } from '@/lib/auth/types';

/**
 * Destino pós-login (F1.2).
 *
 * `next` vem da URL e é, por natureza, entrada não confiável: sem validação um
 * `next=https://mal.example` (ou `//mal.example`, que o navegador lê como
 * host absoluto) transformaria a tela de login num open redirect. Só caminho
 * interno começando com barra simples atravessa.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 512) return null;
  if (!value.startsWith('/')) return null;
  // `//host` e `/\host` são interpretados como URL absoluta por navegadores.
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  return value;
}

/**
 * Para onde mandar quem acabou de verificar o código quando não há `next`.
 *
 * Cliente cai no portal do tenant (`/[slug]`) ou na raiz (domínio próprio);
 * Owner/Staff caem no painel. O papel vem da resposta do verify, nunca do
 * cookie.
 */
export function postLoginDestination(role: Role, basePath: string): string {
  if (role !== 'CUSTOMER') return '/painel';
  return basePath.length > 0 ? basePath : '/';
}

export function resolveNextPath(
  next: string | null | undefined,
  role: Role,
  basePath: string,
): string {
  return safeNextPath(next) ?? postLoginDestination(role, basePath);
}
