'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { refundPayment, RefundError, type RefundDb } from '@/lib/payments/refund';

/**
 * Server action do estorno (tarefa F4.3).
 *
 * Casca fina como a criação da conta (F4.1): revalida `requireRole('OWNER')` —
 * esconder o botão não é controle de acesso — e delega ao núcleo
 * `lib/payments/refund.ts`, que lê o estado escopado, aplica a política de
 * cancelamento do tenant e chama o provedor. O `tenantId` nunca vem do
 * formulário: sai do contexto autenticado.
 *
 * O novo estado do pagamento e o lançamento do estorno vêm pelo webhook, não
 * desta resposta — o painel é revalidado e relê a verdade do banco.
 */

const EXTRATO_PATH = '/painel/financeiro/extrato';
const FINANCEIRO_PATH = '/painel/financeiro';

export type RefundActionResult =
  | { ok: true; amountCents: number }
  | { ok: false; code: string; message: string };

export async function refundPaymentAction(
  paymentId: string,
  amountCents: number | null,
): Promise<RefundActionResult> {
  let context;
  try {
    context = await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Apenas o dono executa estornos.',
      };
    }
    throw error;
  }

  const db: RefundDb = {
    forTenant: (_tenantId, fn) => context.forTenant(fn),
  };

  try {
    const result = await refundPayment({
      db,
      tenantId: context.tenant.id,
      paymentId,
      amountCents,
    });
    revalidatePath(EXTRATO_PATH);
    revalidatePath(FINANCEIRO_PATH);
    return { ok: true, amountCents: result.amountCents };
  } catch (error) {
    if (error instanceof RefundError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
