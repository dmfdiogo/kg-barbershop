import { notFound } from 'next/navigation';
import { getTenantSupportContext } from '@/lib/platform/support';
import {
  SupportAuditTrail,
  SupportBookings,
  SupportHeader,
  SupportSummary,
} from './_components/SupportPanels';

/**
 * Ficha de um tenant para suporte (tarefa F7.3).
 *
 * Toda carga desta página deixa uma linha `tenant.support_access` no
 * `AuditLog` do estabelecimento, gravada por `getTenantSupportContext` ANTES da
 * leitura. É o cumprimento direto de "ninguém olha dado de cliente de salão sem
 * deixar rastro". Id inexistente cai no 404 do segmento (F1.4).
 */
export default async function TenantSupportPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const context = await getTenantSupportContext(tenantId);
  if (!context) notFound();

  return (
    <div className="flex flex-col gap-6">
      <SupportHeader context={context} />
      <SupportSummary context={context} />
      <SupportBookings context={context} />
      <SupportAuditTrail context={context} />
    </div>
  );
}
