import type { PaymentMode } from '@prisma/client';
import type { TenantContext } from '@/lib/tenant/context';

/**
 * Leitura do catálogo público (F3.0).
 *
 * Passa pelo client escopado do tenant — nunca por `PrismaClient` cru. A RLS e
 * o `set_config('app.current_tenant')` filtram qualquer coisa que não seja do
 * estabelecimento resolvido: é essa camada que garante que o portal de um salão
 * não exponha serviço de outro, mesmo que a query "esqueça" o `where`.
 */

export interface PortalService {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
  paymentMode: PaymentMode;
  depositCents: number | null;
  depositPercent: number | null;
}

export async function loadPortalCatalog(context: TenantContext): Promise<PortalService[]> {
  return context.forTenant((tx) =>
    tx.service.findMany({
      where: { active: true },
      orderBy: [{ name: 'asc' }],
      select: {
        id: true,
        name: true,
        durationMin: true,
        bufferMin: true,
        priceCents: true,
        paymentMode: true,
        depositCents: true,
        depositPercent: true,
      },
    }),
  );
}
