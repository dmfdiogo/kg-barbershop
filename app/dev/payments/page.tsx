import { notFound } from 'next/navigation';
import {
  snapshotMockPaymentStore,
  type MockPaymentStoreSnapshot,
} from '@/lib/payments/mock-store';
import { formatCents, formatDateTime } from '../format';
import { isDevConsoleEnabled } from '../guard';

export const dynamic = 'force-dynamic';

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle ? <p className="text-sm text-[var(--color-secondary)]">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function StatusTag({ value }: { value: string }) {
  return (
    <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs">
      {value}
    </span>
  );
}

function ActionButton({
  action,
  label,
  fields,
}: {
  action: string;
  label: string;
  fields?: Record<string, string | number>;
}) {
  return (
    <form method="post" action={action} className="inline">
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
      >
        {label}
      </button>
    </form>
  );
}

function balanceFor(snapshot: MockPaymentStoreSnapshot, accountId: string) {
  let availableCents = 0;
  let pendingCents = 0;
  for (const charge of snapshot.charges) {
    if (charge.accountId !== accountId) {
      continue;
    }
    if (charge.status === 'PENDING') {
      pendingCents += charge.amountCents;
      continue;
    }
    if (
      charge.status === 'PAID' ||
      charge.status === 'PARTIALLY_REFUNDED' ||
      charge.status === 'REFUNDED'
    ) {
      availableCents += Math.max(charge.amountCents - charge.refundedCents, 0);
    }
  }
  return { availableCents, pendingCents };
}

export default async function PaymentsConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isDevConsoleEnabled()) {
    notFound();
  }

  const params = await searchParams;
  const snapshot = snapshotMockPaymentStore();
  const appCharges = new Map(snapshot.appCharges.map((entry) => [entry.chargeId, entry]));
  const appMerchants = new Map(snapshot.appMerchants.map((entry) => [entry.accountId, entry]));

  const event = typeof params.event === 'string' ? params.event : undefined;
  const delivered = params.delivered === 'true';
  const error = typeof params.error === 'string' ? params.error : undefined;

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondary)]">
          Cada botão age como o provedor (muda a verdade do lado do Asaas mock) e dispara um POST
          real para <code className="font-mono">/api/webhooks/payments</code>. O estado do lado da
          aplicação — a coluna <em>app</em> — só muda quando esse webhook chega.
        </p>
        <ActionButton action="/dev/api/payments/demo" label="Criar dados de exemplo" />
      </div>

      {error ? (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm">
          Ação recusada: {error}
        </p>
      ) : null}
      {event ? (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm">
          Evento {event}: {delivered ? 'webhook entregue' : 'webhook NÃO entregue — o estado da aplicação não mudou'}.
        </p>
      ) : null}

      <Section
        title="Contas de recebimento"
        subtitle="KYC do provedor x status que chegou por webhook. Cobrança exige KYC aprovado."
      >
        {snapshot.merchants.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma conta. Use Criar dados de exemplo.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.merchants.map((merchant) => {
              const app = appMerchants.get(merchant.accountId);
              const balance = balanceFor(snapshot, merchant.accountId);
              return (
                <li
                  key={merchant.accountId}
                  className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{merchant.name}</span>
                    <span className="font-mono text-xs text-[var(--color-secondary)]">
                      {merchant.accountId}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1">
                      KYC provedor: <StatusTag value={merchant.kycStatus} />
                    </span>
                    <span className="flex items-center gap-1">
                      KYC app: <StatusTag value={app?.kycStatus ?? '—'} />
                    </span>
                    <span className="font-mono">{merchant.walletId}</span>
                    <span>
                      Disponível {formatCents(balance.availableCents)} · A liberar{' '}
                      {formatCents(balance.pendingCents)}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <ActionButton
                      action="/dev/api/payments/merchant/kyc"
                      label="Aprovar KYC"
                      fields={{ accountId: merchant.accountId, decision: 'APPROVED' }}
                    />
                    <ActionButton
                      action="/dev/api/payments/merchant/kyc"
                      label="Reprovar KYC"
                      fields={{ accountId: merchant.accountId, decision: 'REJECTED' }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Cobranças" subtitle="Nunca nascem pagas: quem marca é o webhook.">
        {snapshot.charges.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma cobrança.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.charges.map((charge) => {
              const app = appCharges.get(charge.id);
              const remaining = charge.amountCents - charge.refundedCents;
              return (
                <li
                  key={charge.id}
                  className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs">{charge.id}</span>
                    <span>{charge.method}</span>
                    <span>{formatCents(charge.amountCents)}</span>
                    <span className="text-xs text-[var(--color-secondary)]">
                      vence {charge.dueDate}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="flex items-center gap-1">
                      Provedor: <StatusTag value={charge.status} />
                    </span>
                    <span className="flex items-center gap-1">
                      App: <StatusTag value={app?.status ?? '—'} />
                    </span>
                    {charge.refundedCents > 0 ? (
                      <span>Estornado {formatCents(charge.refundedCents)}</span>
                    ) : null}
                    {charge.cardLast4 ? <span>cartão •••• {charge.cardLast4}</span> : null}
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    {charge.status === 'PENDING' ? (
                      <>
                        <ActionButton
                          action="/dev/api/payments/charge/confirm"
                          label="Confirmar pagamento"
                          fields={{ chargeId: charge.id }}
                        />
                        <ActionButton
                          action="/dev/api/payments/charge/refuse"
                          label="Recusar"
                          fields={{ chargeId: charge.id }}
                        />
                      </>
                    ) : null}
                    {charge.status === 'PENDING' && charge.method === 'PIX' ? (
                      <ActionButton
                        action="/dev/api/payments/charge/expire"
                        label="Expirar Pix"
                        fields={{ chargeId: charge.id }}
                      />
                    ) : null}
                    {(charge.status === 'PAID' || charge.status === 'PARTIALLY_REFUNDED') &&
                    remaining > 0 ? (
                      <form
                        method="post"
                        action="/dev/api/payments/charge/refund"
                        className="inline-flex items-end gap-1"
                      >
                        <input type="hidden" name="chargeId" value={charge.id} />
                        <label className="flex flex-col text-xs">
                          Estorno (centavos)
                          <input
                            type="number"
                            name="amountCents"
                            defaultValue={remaining}
                            min={1}
                            max={remaining}
                            className="w-28 rounded border border-[var(--color-border)] bg-transparent px-2 py-1"
                          />
                        </label>
                        <button
                          type="submit"
                          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
                        >
                          Estornar
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Assinaturas">
        {snapshot.subscriptions.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma assinatura. O ciclo de vida do clube é a F5.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-[var(--color-border)] p-3 text-xs"
              >
                <span className="font-mono">{subscription.id}</span>
                <span>plano {subscription.planId}</span>
                <span>{formatCents(subscription.amountCents)}</span>
                <span>{subscription.cycle}</span>
                <StatusTag value={subscription.status} />
                <span className="text-[var(--color-secondary)]">
                  próxima {subscription.nextDueDate}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Entregas de webhook" subtitle="Últimas 20 tentativas do mock.">
        {snapshot.webhookDeliveries.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma entrega ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {snapshot.webhookDeliveries.slice(0, 20).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-[var(--color-secondary)]">{formatDateTime(entry.at)}</span>
                <span className="font-mono">{entry.type}</span>
                <span>
                  {entry.delivered
                    ? `entregue (${entry.httpStatus ?? 200})`
                    : `falhou${entry.error ? `: ${entry.error}` : ''}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}
