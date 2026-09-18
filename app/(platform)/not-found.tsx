/**
 * 404 do painel da plataforma (tarefa F1.4).
 *
 * Boundary do grupo `(platform)`: captura o `notFound()` do portão em
 * `app/(platform)/plataforma/layout.tsx` (sessão sem `User.isSuperAdmin`) e
 * qualquer `notFound()` lançado pelas páginas do painel (ex.: id de tenant
 * inexistente na F7.3). É por isso que o portão vive no segmento filho: um
 * `notFound()` no layout do próprio grupo subiria para o 404 da raiz.
 *
 * O not-found da raiz diz "Estabelecimento não encontrado", o que aqui é
 * mentira: não há estabelecimento nenhum no painel. Sem cor literal — tokens,
 * como todo componente de produto.
 */
export default function PlatformNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">Página não encontrada</h1>
      <p className="text-sm text-[var(--color-secondary)]">
        O endereço não existe ou a sua conta não tem acesso a esta área.
      </p>
    </main>
  );
}
