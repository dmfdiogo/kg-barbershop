/**
 * Registro de navegação do painel (tronco F2.0).
 *
 * Este arquivo existe só para ancorar o `import.meta.glob`: o padrão precisa ser
 * relativo ao próprio módulo (glob de `nav.ts` em cada subpasta) e ficar vizinho
 * das features — foi a forma provada pela F3.2 (`lib/booking/confirm.ts`), e
 * evita que os parênteses do grupo de rota `(dashboard)` entrem no padrão do
 * glob (o Vite os lê como grupo e o resultado vem vazio).
 *
 * Quem consome é `components/dashboard/nav.ts`, que faz o cast para o tipo do
 * módulo. Não há arquivo-lista: para entrar no menu basta criar
 * `app/(dashboard)/painel/<feature>/nav.ts`.
 */
export const navModules = import.meta.glob('./*/nav.ts', { eager: true }) as Record<
  string,
  unknown
>;
