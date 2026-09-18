import { TenantNotFoundPage } from '@/app/tenant-status';

/**
 * 404 próprio do portal: quem chama `notFound()` no layout é o tenant que não
 * existe, e o usuário merece uma página com contexto — não o 404 genérico do
 * Next.
 */
export default function TenantNotFound() {
  return <TenantNotFoundPage />;
}
