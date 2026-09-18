import { TenantNotFoundPage } from './tenant-status';

/**
 * `not-found.tsx` da raiz (F1.0).
 *
 * POR QUE NA RAIZ, E NÃO EM `app/[slug]/not-found.tsx`: o boundary de
 * `not-found` envolve o `page` do segmento, e fica POR DENTRO do `layout`. Um
 * `notFound()` chamado no layout de `[slug]` (é lá que o portão de tenant vive)
 * não é capturado pelo not-found do próprio segmento — sobe para o boundary
 * ancestral. O da raiz é o único que cobre os dois casos.
 *
 * O efeito colateral é que rotas não casadas também caem aqui. Neste produto
 * isso é aceitável e até desejável: um 404 quase sempre é um slug de
 * estabelecimento errado. Segmentos que precisem de 404 próprio (ex.: painel da
 * plataforma) declaram o seu `not-found.tsx` no próprio segmento.
 */
export default function NotFound() {
  return <TenantNotFoundPage />;
}
