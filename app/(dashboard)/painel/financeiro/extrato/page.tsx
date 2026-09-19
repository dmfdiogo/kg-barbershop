import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { loadFinancialOverview } from '@/lib/payments/statement';
import { BalanceCards } from './_components/BalanceCards';
import { Statement } from './_components/Statement';

/**
 * Extrato completo com estorno (tarefa F4.3).
 *
 * OWNER-only e negando por exceção, como a conta de recebimento. O estorno é
 * disparado pelo próprio extrato; a política de cancelamento do tenant decide o
 * teto e a server action revalida papel e política — o cliente não decide nada.
 */
async function requireOwnerOrNotFound() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export default async function ExtratoPage() {
  const context = await requireOwnerOrNotFound();
  const overview = await loadFinancialOverview(
    { forTenant: (_tenantId, fn) => context.forTenant(fn) },
    context.tenant.id,
  );

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Extrato</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            Cada pagamento e cada estorno do estabelecimento, do mais recente para
            o mais antigo.
          </p>
        </div>
        <Link
          href="/painel/financeiro"
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          Voltar ao financeiro
        </Link>
      </header>

      <BalanceCards
        availableCents={overview.availableCents}
        pendingCents={overview.pendingCents}
        paidCents={overview.paidCents}
        refundedCents={overview.refundedCents}
      />

      <Statement
        entries={overview.entries}
        timezone={context.tenant.timezone}
        allowRefund
      />
    </section>
  );
}
