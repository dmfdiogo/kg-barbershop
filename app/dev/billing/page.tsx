import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BILLING_PLAN_CODES, BILLING_PLANS } from '@/lib/billing/plans';
import { formatCents, formatDateTime } from '../format';
import { isDevConsoleEnabled } from '../guard';
import { loadBillingConsoleData, type BillingConsoleData } from './_data';

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

function statusTone(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'COMPLETED':
      return 'text-[var(--color-success)]';
    case 'TRIALING':
    case 'PAST_DUE':
    case 'PENDING':
      return 'text-[var(--color-warning)]';
    case 'CANCELED':
    case 'EXPIRED':
      return 'text-[var(--color-danger)]';
    default:
      return 'text-[var(--color-secondary)]';
  }
}

function StatusTag({ value }: { value: string }) {
  return (
    <span
      className={`rounded border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs ${statusTone(value)}`}
    >
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

function OpenCheckoutForm({ tenants }: { tenants: BillingConsoleData['tenants'] }) {
  return (
    <form
      method="post"
      action="/dev/api/billing/demo"
      className="flex flex-wrap items-end gap-3 text-sm"
    >
      <label className="flex flex-col gap-1 text-xs">
        Estabelecimento
        <select
          name="tenantId"
          defaultValue={tenants.find((tenant) => tenant.canStartCheckout)?.id ?? tenants[0]?.id}
          className="min-w-56 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name} ({tenant.slug}){tenant.canStartCheckout ? '' : ' — já assinante'}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Plano
        <select
          name="plan"
          defaultValue="EQUIPE"
          className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          {BILLING_PLAN_CODES.map((code) => (
            <option key={code} value={code}>
              {BILLING_PLANS[code].name} — {formatCents(BILLING_PLANS[code].priceCents)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
      >
        Abrir sessão de checkout
      </button>
    </form>
  );
}

export default async function BillingConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isDevConsoleEnabled()) {
    notFound();
  }

  const params = await searchParams;
  const data = await loadBillingConsoleData();

  const error = typeof params.error === 'string' ? params.error : undefined;
  const event = typeof params.evento === 'string' ? params.evento : undefined;
  const delivered = params.entregue === 'true';
  const highlightSession = typeof params.sessao === 'string' ? params.sessao : undefined;
  const filterCustomer = typeof params.cliente === 'string' ? params.cliente : undefined;

  const subscriptions = filterCustomer
    ? data.subscriptions.filter((subscription) => subscription.customerId === filterCustomer)
    : data.subscriptions;

  return (
    <main className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondary)]">
          Console do billing B2B. Cada botão age como o provedor (muda a verdade do lado do Stripe
          mock) e dispara um POST real para <code className="font-mono">/api/webhooks/billing</code>.
          O <code className="font-mono">PlatformSub</code> da aplicação — a coluna <em>app</em> — só
          muda quando esse webhook chega. O cartão não passa por aqui: concluir a sessão é o que o
          dono faria na página hospedada do provedor.
        </p>
      </div>

      {error ? (
        <p className="rounded border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3 text-sm">
          Ação recusada: {error}
        </p>
      ) : null}
      {event ? (
        <p className="rounded border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm">
          Evento {event}:{' '}
          {delivered
            ? 'webhook entregue'
            : 'webhook NÃO entregue — o estado da aplicação não mudou'}
          .
        </p>
      ) : null}

      <Section
        title="Abrir sessão de checkout"
        subtitle="Cria o cliente de cobrança e a sessão pendente, como o produto faria ao mandar o dono assinar."
      >
        {data.tenants.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhum estabelecimento no banco. Rode o seed.
          </p>
        ) : (
          <OpenCheckoutForm tenants={data.tenants} />
        )}
      </Section>

      <Section
        title="Sessões de checkout"
        subtitle="A assinatura não existe enquanto a sessão está pendente: quem a cria é o webhook."
      >
        {data.sessions.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma sessão. Use Abrir sessão de checkout.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.sessions.map((session) => {
              const highlighted = session.id === highlightSession;
              return (
                <li
                  key={session.id}
                  className={`flex flex-col gap-2 rounded border p-3 text-sm ${
                    highlighted
                      ? 'border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs">{session.id}</span>
                    <StatusTag value={session.status} />
                    {highlighted ? (
                      <span className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-xs">
                        sessão da URL
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span>cliente: {session.customerName ?? session.customerId}</span>
                    <span className="font-mono text-[var(--color-secondary)]">
                      {session.customerId}
                    </span>
                    <span>plano: {session.planName}</span>
                    <span>
                      valor:{' '}
                      {session.priceCents === null ? '—' : formatCents(session.priceCents)}
                    </span>
                    <span className="text-[var(--color-secondary)]">
                      válida até {formatDateTime(session.expiresAt)}
                    </span>
                  </div>
                  {session.status === 'PENDING' ? (
                    <div className="flex gap-2">
                      <ActionButton
                        action="/dev/api/billing/checkout/complete"
                        label="Concluir pagamento"
                        fields={{ sessionId: session.id }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Assinaturas"
        subtitle={
          filterCustomer
            ? `Filtradas pelo cliente ${filterCustomer}.`
            : 'A coluna app é o PlatformSub persistido, atualizado só por webhook.'
        }
      >
        {filterCustomer ? (
          <p className="text-xs">
            <Link className="underline" href="/dev/billing">
              Limpar filtro
            </Link>
          </p>
        ) : null}
        {subscriptions.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma assinatura.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {subscriptions.map((subscription) => (
              <li
                key={subscription.id}
                className="flex flex-col gap-2 rounded border border-[var(--color-border)] p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="font-mono">{subscription.id}</span>
                  <span>cliente: {subscription.customerName ?? subscription.customerId}</span>
                  <span>plano: {subscription.planName}</span>
                  <span>{formatCents(subscription.amountCents)}</span>
                  <span className="text-[var(--color-secondary)]">
                    período até {formatDateTime(subscription.currentPeriodEnd)}
                  </span>
                  {subscription.cancelAtPeriodEnd ? (
                    <span className="text-[var(--color-warning)]">cancela no fim do período</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span className="flex items-center gap-1">
                    provedor: <StatusTag value={subscription.status} />
                  </span>
                  <span className="flex items-center gap-1">
                    app: <StatusTag value={subscription.appStatus ?? '—'} />
                  </span>
                  {subscription.tenantId ? (
                    <span className="font-mono text-[var(--color-secondary)]">
                      {subscription.tenantId}
                    </span>
                  ) : null}
                </div>
                {subscription.status !== 'CANCELED' ? (
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action="/dev/api/billing/subscription/invoice-paid"
                      label="Marcar fatura paga"
                      fields={{ subscriptionId: subscription.id }}
                    />
                    <ActionButton
                      action="/dev/api/billing/subscription/invoice-failed"
                      label="Simular falha de pagamento"
                      fields={{ subscriptionId: subscription.id }}
                    />
                    <ActionButton
                      action="/dev/api/billing/subscription/cancel"
                      label="Cancelar"
                      fields={{ subscriptionId: subscription.id }}
                    />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Entregas de webhook" subtitle="Últimas 20 tentativas do mock.">
        {data.deliveries.length === 0 ? (
          <p className="rounded border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
            Nenhuma entrega ainda.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-xs">
            {data.deliveries.map((entry) => (
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
