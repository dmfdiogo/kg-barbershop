import type { Route } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth/rbac';
import {
  assessPlanChange,
  type AgendaUsage,
} from '@/lib/billing/limits';
import {
  BILLING_PLAN_CODES,
  BILLING_PLANS,
  isBillingPlanCode,
  type BillingPlanCode,
} from '@/lib/billing/plans';
import type { TrialStatus } from '@/lib/billing/trial';
import { formatCents } from '@/lib/money';
import {
  loadBillingOverview,
  type BillingOverview,
  type SubscriptionPhase,
} from './_lib/overview';
import {
  formatBillingDate,
  phaseTone,
  planFeatures,
  planPriceLabel,
} from './_lib/presentation';
import { CancelSubscriptionPanel } from './_components/CancelSubscriptionPanel';
import { CheckoutButton } from './_components/CheckoutButton';
import { PlanChangePanel } from './_components/PlanChangePanel';
import { PortalButton } from './_components/PortalButton';
import { RefreshButton } from './_components/RefreshButton';

/**
 * Assinatura da plataforma (tarefa F8.0-B).
 *
 * O buraco que esta tela fecha: o produto cobra R$ 39,90/79,90/139,90 por mês e
 * a trial por valor bloqueia no 11º agendamento, mas não havia onde o dono
 * assinar — o domínio inteiro de `lib/billing/` só era consumido pelo webhook.
 *
 * O CARTÃO NÃO PASSA AQUI. Assinar e trocar cartão são redirecionamentos para o
 * Checkout e o portal hospedados (`lib/billing/types.ts`). A assinatura não
 * nasce ao voltar do Checkout: nasce no webhook, e por isso o estado
 * `AWAITING` existe e diz "aguardando confirmação" em vez de mentir "ativa".
 *
 * O portão é duplo: o layout do segmento e as server actions exigem `OWNER`, e o
 * menu só mostra o item para o dono. Isolamento e leitura passam pelo client
 * escopado (`context.forTenant`).
 */
interface AssinaturaPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function AssinaturaPage({ searchParams }: AssinaturaPageProps) {
  const context = await requireRole('OWNER');
  const query = await searchParams;
  const tenantId = context.tenant.id;

  const rawPlan = firstValue(query.plano);
  const requestedPlan: BillingPlanCode | null =
    rawPlan && isBillingPlanCode(rawPlan) ? rawPlan : null;

  const { overview, assessment } = await context.forTenant(async (tx) => {
    const overview = await loadBillingOverview(tx, tenantId);
    // A decisão de downgrade é calculada no SERVIDOR, a partir do plano pedido
    // na URL. Sem escolha suficiente, `changePlan` recusa e nada é gravado.
    const shouldAssess =
      overview.canManage &&
      requestedPlan !== null &&
      requestedPlan !== overview.subscription?.plan;
    const assessment = shouldAssess
      ? await assessPlanChange(tx, tenantId, requestedPlan)
      : null;
    return { overview, assessment };
  });

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Assinatura</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          O plano do sistema, a cobrança e o meio de pagamento do estabelecimento.
        </p>
      </header>

      <CheckoutNotice checkout={firstValue(query.checkout)} />

      <StatusCard overview={overview} timezone={context.tenant.timezone} />

      <PlansSection overview={overview} />

      {assessment ? <PlanChangePanel assessment={assessment} /> : null}

      {overview.canManage ? (
        <CancelSubscriptionPanel timezone={context.tenant.timezone} />
      ) : null}
    </section>
  );
}

function CheckoutNotice({ checkout }: { checkout: string | null }) {
  if (checkout === 'cancelado') {
    return (
      <aside role="status" className="rounded-xl bg-[var(--color-muted)] px-4 py-3 text-sm">
        Você interrompeu o pagamento. Nenhuma cobrança foi feita.
      </aside>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Estado atual
// ---------------------------------------------------------------------------

function StatusCard({ overview, timezone }: { overview: BillingOverview; timezone: string }) {
  const { phase, subscription, trial, usage } = overview;
  const tone = phaseTone(phase);
  const plan = subscription ? BILLING_PLANS[subscription.plan] : null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--color-secondary)]">Estado atual</h2>
          <p className="mt-1 text-lg font-semibold">
            {plan ? `Plano ${plan.name}` : 'Período de teste'}
          </p>
          {plan ? (
            <p className="mt-0.5 text-sm text-[var(--color-secondary)]">
              {planPriceLabel(plan.priceCents)}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone.className}`}
        >
          {tone.label}
        </span>
      </div>

      <PhaseBody phase={phase} overview={overview} timezone={timezone} />

      {phase === 'TRIAL' || phase === 'AWAITING' ? (
        <TrialUsage trial={trial} showSuggestion={phase === 'TRIAL'} />
      ) : null}

      <AgendaUsageLine usage={usage} />
    </section>
  );
}

function PhaseBody({
  phase,
  overview,
  timezone,
}: {
  phase: SubscriptionPhase;
  overview: BillingOverview;
  timezone: string;
}) {
  const subscription = overview.subscription;

  if (phase === 'TRIAL') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-[var(--color-secondary)]">
          Você está usando o sistema gratuitamente enquanto conhece a ferramenta.
        </p>
        {overview.trial.message ? (
          <p className="text-sm text-[var(--color-warning)]">{overview.trial.message}</p>
        ) : null}
      </div>
    );
  }

  if (phase === 'AWAITING') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondary)]">
          Estamos aguardando a confirmação do pagamento do plano{' '}
          {subscription ? BILLING_PLANS[subscription.plan].name : ''} pelo provedor. Assim
          que o pagamento for confirmado, a assinatura é ativada automaticamente — se você
          acabou de pagar, isso pode levar alguns instantes. Se você não chegou a concluir
          o pagamento, nenhuma cobrança foi feita.
        </p>
        <div>
          <RefreshButton label="Já paguei, atualizar" />
        </div>
      </div>
    );
  }

  if (phase === 'TRIALING') {
    const end = subscription?.trialEndedAt ?? subscription?.currentPeriodEnd ?? null;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondary)]">
          Sua assinatura está em período de teste
          {end ? ` até ${formatBillingDate(end, timezone)}` : ''}. Depois disso, a
          mensalidade começa a ser cobrada.
        </p>
        <div>
          <PortalButton label="Trocar cartão ou ver faturas" />
        </div>
      </div>
    );
  }

  if (phase === 'ACTIVE') {
    const end = subscription?.currentPeriodEnd ?? null;
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--color-secondary)]">
          {end
            ? `Próxima cobrança em ${formatBillingDate(end, timezone)}.`
            : 'Assinatura em dia.'}
        </p>
        <div>
          <PortalButton label="Trocar cartão ou ver faturas" />
        </div>
      </div>
    );
  }

  if (phase === 'PAST_DUE') {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
          A mensalidade está em atraso. Novos agendamentos estão bloqueados, mas os já
          marcados continuam disponíveis. Regularize o pagamento para voltar a receber
          agendamentos.
        </p>
        <div>
          <PortalButton label="Atualizar pagamento" variant="primary" />
        </div>
      </div>
    );
  }

  // CANCELED
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-secondary)]">
        A assinatura foi cancelada. Novos agendamentos estão bloqueados; os que já existem
        continuam disponíveis.
      </p>
      <div>
        <PortalButton label="Ver faturas" />
      </div>
    </div>
  );
}

function TrialUsage({
  trial,
  showSuggestion,
}: {
  trial: TrialStatus;
  showSuggestion: boolean;
}) {
  const percent = trial.limit > 0 ? Math.min(100, Math.round((trial.used / trial.limit) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs text-[var(--color-secondary)]">
        <span>
          {trial.used} de {trial.limit} agendamentos gratuitos usados
        </span>
        <span>
          {trial.remaining === 0
            ? 'Trial esgotado'
            : `${trial.remaining} restante(s)`}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-border)]">
        <div
          className="h-full rounded-full bg-[var(--color-primary)]"
          style={{ width: `${percent}%` }}
        />
      </div>
      {showSuggestion && trial.upgrade ? (
        <p className="text-xs text-[var(--color-secondary)]">
          Sugestão: plano {trial.upgrade.name} por{' '}
          {formatCents(trial.upgrade.priceCents)}/mês.
        </p>
      ) : null}
    </div>
  );
}

function AgendaUsageLine({ usage }: { usage: AgendaUsage }) {
  const limit = usage.limit === null ? 'sem limite' : `${usage.limit} no plano`;
  return (
    <p className="text-xs text-[var(--color-secondary)]">
      {usage.activeAgendas} agenda(s) ativa(s) · limite {limit}
      {usage.planName ? ` · ${usage.planName}` : ''}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Planos
// ---------------------------------------------------------------------------

function PlansSection({ overview }: { overview: BillingOverview }) {
  const currentCode = overview.subscription?.plan ?? null;

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">Planos</h2>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          {overview.canManage
            ? 'Troque de plano quando quiser — a diferença é prorrateada pelo provedor.'
            : 'Escolha o plano para começar a cobrar pelo sistema.'}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {BILLING_PLAN_CODES.map((code) => (
          <PlanCard
            key={code}
            code={code}
            overview={overview}
            isCurrent={overview.canManage && currentCode === code}
          />
        ))}
      </div>

      {overview.phase === 'AWAITING' ? (
        <p className="text-xs text-[var(--color-secondary)]">
          Os planos ficam disponíveis para troca assim que o pagamento for confirmado.
        </p>
      ) : null}
      {overview.phase === 'CANCELED' ? (
        <p className="text-xs text-[var(--color-secondary)]">
          A assinatura está cancelada: novos agendamentos ficam bloqueados; os que já
          existem continuam disponíveis.
        </p>
      ) : null}
    </section>
  );
}

function PlanCard({
  code,
  overview,
  isCurrent,
}: {
  code: BillingPlanCode;
  overview: BillingOverview;
  isCurrent: boolean;
}) {
  const plan = BILLING_PLANS[code];
  const canSubscribe = overview.phase === 'TRIAL';

  return (
    <article
      className={
        isCurrent
          ? 'flex flex-col rounded-xl border-2 border-[var(--color-primary)] p-4'
          : 'flex flex-col rounded-xl border border-[var(--color-border)] p-4'
      }
    >
      <p className="text-sm font-semibold">{plan.name}</p>
      <p className="mt-0.5 text-sm font-medium">{planPriceLabel(plan.priceCents)}</p>
      <ul className="mt-3 flex flex-col gap-1 text-xs text-[var(--color-secondary)]">
        {planFeatures(plan).map((feature) => (
          <li key={feature}>• {feature}</li>
        ))}
      </ul>

      <div className="mt-4">
        {isCurrent ? (
          <span className="inline-block rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-success)]">
            Plano atual
          </span>
        ) : overview.canManage ? (
          <Link
            href={`/painel/assinatura?plano=${code}` as Route}
            className="inline-block rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
          >
            Mudar para {plan.name}
          </Link>
        ) : canSubscribe ? (
          <CheckoutButton plan={code} label={`Assinar ${plan.name}`} />
        ) : null}
      </div>
    </article>
  );
}
