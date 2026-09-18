/**
 * Console de desenvolvimento (`fases/contexto-comum.md` §5.3).
 *
 * O bloqueio é no servidor: cada página e cada action confere o ambiente antes
 * de ler ou mudar qualquer estado. Esconder o link não é controle de acesso.
 */
export function isDevConsoleEnabled(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function notFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
