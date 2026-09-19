'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole, type RequestContext } from '@/lib/auth/rbac';
import {
  createMerchantAccount,
  isMerchantProviderError,
  MerchantAccountError,
  type MerchantAccountDb,
  type MerchantAccountView,
} from '@/lib/payments/merchant';

/**
 * Server action do recebimento (tarefa F4.1).
 *
 * Casca fina: revalida `requireRole('OWNER')` (esconder o menu não é controle de
 * acesso) e delega ao núcleo `lib/payments/merchant.ts`, que lê o CPF/CNPJ e a
 * chave Pix da F2.5, cria a subconta no provider e persiste cifrada. O
 * `tenantId` nunca vem do formulário: sai do contexto autenticado.
 *
 * A criação é idempotente — clicar duas vezes devolve a mesma conta.
 */

const CONTA_PATH = '/painel/financeiro/conta';

export type CreateReceivingAccountResult =
  | { ok: true; account: MerchantAccountView }
  | { ok: false; code: 'FORBIDDEN' | 'PIX_KEY_MISSING' | 'ACCOUNT_NOT_CREATED'; message: string };

export async function createReceivingAccountAction(): Promise<CreateReceivingAccountResult> {
  let context: RequestContext;
  try {
    context = await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        code: 'FORBIDDEN',
        message: 'Apenas o dono configura a conta de recebimento.',
      };
    }
    throw error;
  }

  const db: MerchantAccountDb = {
    forTenant: (_tenantId, fn) => context.forTenant(fn),
  };

  try {
    const account = await createMerchantAccount(db, context.tenant.id);
    revalidatePath(CONTA_PATH);
    return { ok: true, account };
  } catch (error) {
    if (error instanceof MerchantAccountError) {
      return { ok: false, code: error.code, message: error.message };
    }
    if (isMerchantProviderError(error)) {
      return {
        ok: false,
        code: 'ACCOUNT_NOT_CREATED',
        message:
          'O provedor recusou a criação da conta. Confira o CPF/CNPJ e a chave Pix e tente novamente.',
      };
    }
    throw error;
  }
}
