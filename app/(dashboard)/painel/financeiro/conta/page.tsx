import { notFound } from 'next/navigation';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import {
  loadReceivingCapability,
  type MerchantAccountDb,
} from '@/lib/payments/merchant';
import { ReceivingAccountCard } from './_components/ReceivingAccountCard';

/**
 * Conta de recebimento (tarefa F4.1).
 *
 * O layout do segmento já exige OWNER; aqui reforçamos com o mesmo tratamento
 * para o caso de a página ser chamada sem o layout (testes).
 *
 * A tela mostra o estado do KYC e o que falta. Enquanto o KYC não for aprovado,
 * o salão NÃO fica travado: a capability marca `online: false` e o texto deixa
 * claro que os agendamentos seguem com pagamento no local.
 */
async function requireOwnerOrNotFound() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export default async function ContaRecebimentoPage() {
  const context = await requireOwnerOrNotFound();
  const db: MerchantAccountDb = {
    forTenant: (_tenantId, fn) => context.forTenant(fn),
  };
  const capability = await loadReceivingCapability(db, context.tenant.id);

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Recebimento</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Conta que recebe os pagamentos dos seus clientes. Pix e cartão ficam
          disponíveis no portal assim que a análise do provedor for aprovada.
        </p>
      </header>

      <ReceivingAccountCard capability={capability} />
    </section>
  );
}
