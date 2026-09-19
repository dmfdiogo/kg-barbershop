import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { loadFinancialOverview } from '@/lib/payments/statement';
import { BalanceCards } from './extrato/_components/BalanceCards';
import { Statement } from './extrato/_components/Statement';
import { ReceivingAccountCard } from './conta/_components/ReceivingAccountCard';

/**
 * Financeiro do estabelecimento (tarefa F4.3).
 *
 * É a resposta da spec §3.2: o dono vê saldo e extrato DENTRO do SaaS, sem
 * abrir o painel do Asaas. O layout do painel já exige STAFF; como a informação
 * é financeira, a página reafirma `OWNER` (o mesmo critério da conta de
 * recebimento) e nega LANÇANDO, nunca renderizando a tela protegida atrás da
 * negação.
 *
 * Saldo e extrato vêm de uma leitura escopada única (`loadFinancialOverview`):
 * se o tenant não tem escopo, a RLS devolve vazio — nunca o extrato do vizinho.
 */
async function requireOwnerOrNotFound() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export default async function FinanceiroPage() {
  const context = await requireOwnerOrNotFound();
  const overview = await loadFinancialOverview(
    { forTenant: (_tenantId, fn) => context.forTenant(fn) },
    context.tenant.id,
    { entryLimit: 5 },
  );

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Financeiro</h1>
          <p className="mt-1 text-sm text-[var(--color-secondary)]">
            Saldo e lançamentos dos pagamentos recebidos pelo seu estabelecimento.
          </p>
        </div>
        <Link
          href="/painel/financeiro/extrato"
          className="text-sm font-medium underline-offset-2 hover:underline"
        >
          Ver extrato completo
        </Link>
      </header>

      <BalanceCards
        availableCents={overview.availableCents}
        pendingCents={overview.pendingCents}
        paidCents={overview.paidCents}
        refundedCents={overview.refundedCents}
      />

      {!overview.receiving.online ? (
        <p className="rounded-lg bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-secondary)]">
          Recebimento online indisponível agora — seus agendamentos seguem
          funcionando com pagamento no local.
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Últimos lançamentos</h2>
        <Statement entries={overview.entries} timezone={context.tenant.timezone} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Recebimento</h2>
          <Link
            href="/painel/financeiro/conta"
            className="text-xs font-medium text-[var(--color-secondary)] underline-offset-2 hover:underline"
          >
            Detalhes da conta
          </Link>
        </div>
        <ReceivingAccountCard capability={overview.receiving} />
      </section>
    </section>
  );
}
