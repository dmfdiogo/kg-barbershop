'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { CheckoutQuote, CheckoutResult } from '@/lib/payments/charge';
import { confirmWithCreditAction, startCheckoutAction } from '../actions';
import { countdownLabel, dateTimeLabel, formatCents } from '../_lib/format';

/**
 * Fluxo de checkout (F4.2), mobile-first e só com tokens de tema.
 *
 * A tela decide a forma de pagamento conforme a modalidade efetiva do serviço
 * (integral antecipado, sinal ou no local). O tempo restante da janela do hold é
 * visível o tempo todo — pagar fora da janela devolve o slot.
 */

type View = 'choose' | 'pix' | 'card' | 'done';

interface PaymentCharge {
  kind: 'charge';
  method: 'PIX' | 'CARD';
  amountCents: number;
  platformFeeCents: number;
  pixCopyPaste?: string;
  cardLast4?: string;
}

export function CheckoutFlow({ quote }: { quote: CheckoutQuote }) {
  const [view, setView] = useState<View>('choose');
  const [charge, setCharge] = useState<PaymentCharge | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [usedCredit, setUsedCredit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [remainingMs, setRemainingMs] = useState(0);
  const submittingRef = useRef(false);

  const expiresAt = quote.holdExpiresAt ? Date.parse(quote.holdExpiresAt) : null;

  useEffect(() => {
    if (view === 'done' || expiresAt === null) return;
    const tick = () => setRemainingMs(expiresAt - Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [view, expiresAt]);

  function run(method: 'PIX' | 'CARD', card?: PaymentChargeCard) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      const result = await startCheckoutAction({
        holdId: quote.holdId,
        method,
        ...(card ? { card } : {}),
      });
      submittingRef.current = false;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      applyResult(result.value);
    });
  }

  /**
   * Caminho do assinante: confirma consumindo um crédito, sem pagamento nenhum.
   * O débito acontece dentro da transação da confirmação, então um saldo que
   * acabou entre a tela e o clique vira erro aqui — e não atendimento de graça.
   */
  function runCredit() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    startTransition(async () => {
      const result = await confirmWithCreditAction({ holdId: quote.holdId });
      submittingRef.current = false;
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setUsedCredit(true);
      setConfirmed(true);
      setView('done');
    });
  }

  function applyResult(result: CheckoutResult) {
    if (result.kind === 'on_site') {
      setConfirmed(true);
      setView('done');
      return;
    }
    setCharge(result);
    setView(result.method === 'PIX' ? 'pix' : 'done');
  }

  if (view === 'done') {
    return <DoneView quote={quote} charge={charge} onSite={confirmed} usedCredit={usedCredit} />;
  }

  // Coberto pelo clube: a tela NÃO oferece forma de pagamento. Oferecer seria
  // convidar o assinante a pagar de novo por algo que ele já paga na
  // mensalidade — e o servidor recusaria de qualquer forma.
  const coveredByClub = quote.credit.covered && !quote.credit.requiresDeposit;

  const overdue = expiresAt !== null && remainingMs <= 0;
  const urgent = expiresAt !== null && remainingMs <= 2 * 60 * 1000;

  return (
    <div className="flex flex-col gap-6">
      <Summary quote={quote} />

      <p
        role="timer"
        className={`rounded-lg px-3 py-2 text-sm ${
          urgent
            ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
            : 'bg-[var(--color-muted)] text-[var(--color-secondary)]'
        }`}
      >
        {overdue ? (
          <>Tempo de reserva encerrado. Recomece o agendamento para não perder o horário.</>
        ) : (
          <>
            Conclua o pagamento em{' '}
            <span className="font-mono font-semibold text-[var(--color-foreground)]">
              {countdownLabel(remainingMs)}
            </span>
          </>
        )}
      </p>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {view === 'choose' && coveredByClub && (
        <UseCredit
          balance={quote.credit.balance}
          pending={pending}
          overdue={overdue}
          onConfirm={runCredit}
        />
      )}

      {view === 'choose' && !coveredByClub && (
        <ChoosePayment
          quote={quote}
          pending={pending}
          overdue={overdue}
          onRun={run}
          onChooseCard={() => setView('card')}
        />
      )}

      {view === 'pix' && charge?.pixCopyPaste ? (
        <PixPanel charge={charge} />
      ) : null}

      {view === 'card' ? (
        <CardForm pending={pending} onSubmit={(card) => run('CARD', card)} />
      ) : null}
    </div>
  );
}

interface PaymentChargeCard {
  number: string;
  holderName: string;
  expiryMonth: string;
  expiryYear: string;
  ccv: string;
}

function ChoosePayment({
  quote,
  pending,
  overdue,
  onRun,
  onChooseCard,
}: {
  quote: CheckoutQuote;
  pending: boolean;
  overdue: boolean;
  onRun: (method: 'PIX' | 'CARD') => void;
  onChooseCard: () => void;
}) {
  if (quote.effectiveMode === 'ON_SITE') {
    return (
      <div className="flex flex-col gap-3">
        {quote.degraded ? (
          <p className="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2 text-sm text-[var(--color-warning)]">
            O recebimento online deste salão ainda está em análise. Você pode concluir
            normalmente e pagar no local.
          </p>
        ) : null}
        <p className="text-sm text-[var(--color-secondary)]">
          O pagamento é feito no estabelecimento. É só confirmar o agendamento.
        </p>
        <button
          type="button"
          disabled={pending || overdue}
          onClick={() => onRun('PIX')}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
        >
          {pending ? 'Confirmando…' : 'Confirmar agendamento'}
        </button>
      </div>
    );
  }

  const isDeposit = quote.effectiveMode === 'DEPOSIT';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] p-4 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-[var(--color-secondary)]">
            {isDeposit ? 'Sinal' : 'Total'}
          </span>
          <span className="font-semibold">{formatCents(quote.chargeAmountCents)}</span>
        </div>
        <div className="flex justify-between gap-4 text-xs text-[var(--color-secondary)]">
          <span>Taxa do estabelecimento (split da plataforma)</span>
          <span>{formatCents(quote.platformFeeCents)}</span>
        </div>
        {isDeposit ? (
          <p className="pt-1 text-xs text-[var(--color-secondary)]">
            O restante de {formatCents(quote.priceCents - quote.chargeAmountCents)} é pago no local.
          </p>
        ) : null}
      </div>

      <button
        type="button"
        disabled={pending || overdue}
        onClick={() => onRun('PIX')}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {pending ? 'Gerando…' : `Pagar ${formatCents(quote.chargeAmountCents)} com Pix`}
      </button>

      {!isDeposit ? (
        <button
          type="button"
          disabled={pending || overdue}
          onClick={onChooseCard}
          className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-base font-semibold disabled:opacity-60"
        >
          Pagar com cartão
        </button>
      ) : null}
    </div>
  );
}

function PixPanel({ charge }: { charge: PaymentCharge }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4 text-sm"
    >
      <p className="font-semibold">Pix gerado</p>
      <p className="text-[var(--color-secondary)]">
        Abra o app do seu banco, escolha Pix copia-e-cola e confirme{' '}
        {formatCents(charge.amountCents)}.
      </p>
      <code className="break-all rounded-lg bg-[var(--color-muted)] px-3 py-2 font-mono text-xs">
        {charge.pixCopyPaste}
      </code>
      <p className="text-xs text-[var(--color-secondary)]">
        A confirmação chega automaticamente. Se o Pix expirar, o horário é liberado.
      </p>
    </div>
  );
}

function CardForm({
  pending,
  onSubmit,
}: {
  pending: boolean;
  onSubmit: (card: PaymentChargeCard) => void;
}) {
  const [number, setNumber] = useState('');
  const [holderName, setHolderName] = useState('');
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [ccv, setCcv] = useState('');

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ number, holderName, expiryMonth, expiryYear, ccv });
      }}
      className="flex flex-col gap-3"
    >
      <label className="flex flex-col gap-1 text-sm">
        Número do cartão
        <input
          inputMode="numeric"
          autoComplete="cc-number"
          value={number}
          onChange={(event) => setNumber(event.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 outline-none focus:border-[var(--color-primary)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Nome impresso no cartão
        <input
          autoComplete="cc-name"
          value={holderName}
          onChange={(event) => setHolderName(event.target.value)}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 outline-none focus:border-[var(--color-primary)]"
        />
      </label>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Mês
          <input
            inputMode="numeric"
            maxLength={2}
            autoComplete="cc-exp-month"
            value={expiryMonth}
            onChange={(event) => setExpiryMonth(event.target.value.replace(/\D/g, ''))}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Ano
          <input
            inputMode="numeric"
            maxLength={4}
            autoComplete="cc-exp-year"
            value={expiryYear}
            onChange={(event) => setExpiryYear(event.target.value.replace(/\D/g, ''))}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 outline-none focus:border-[var(--color-primary)]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          CCV
          <input
            inputMode="numeric"
            maxLength={4}
            autoComplete="cc-csc"
            value={ccv}
            onChange={(event) => setCcv(event.target.value.replace(/\D/g, ''))}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 outline-none focus:border-[var(--color-primary)]"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {pending ? 'Processando…' : 'Pagar com cartão'}
      </button>
    </form>
  );
}

function Summary({ quote }: { quote: CheckoutQuote }) {
  return (
    <header className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-secondary)]">
        {quote.effectiveMode === 'ON_SITE'
          ? 'Pagamento no local'
          : quote.effectiveMode === 'DEPOSIT'
            ? 'Sinal antecipado'
            : 'Pagamento online'}
      </p>
      <h1 className="text-xl font-semibold">{quote.serviceName}</h1>
      <p className="text-sm text-[var(--color-secondary)]">
        {dateTimeLabel(quote.startsAt, quote.timezone)} com {quote.staffName}
      </p>
      <p className="text-sm text-[var(--color-secondary)]">
        Valor do serviço: {formatCents(quote.priceCents)}
      </p>
    </header>
  );
}

/**
 * Confirmação pelo clube: sem forma de pagamento, porque não há pagamento.
 * O saldo aparece para o assinante saber quanto sobra do ciclo.
 */
function UseCredit({
  balance,
  pending,
  overdue,
  onConfirm,
}: {
  balance: number;
  pending: boolean;
  overdue: boolean;
  onConfirm: () => void;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4">
      <h2 className="text-base font-semibold">Coberto pelo seu clube</h2>
      <p className="text-sm text-[var(--color-secondary)]">
        Este serviço faz parte do seu plano. Você tem{' '}
        <span className="font-semibold text-[var(--color-foreground)]">
          {balance} {balance === 1 ? 'crédito' : 'créditos'}
        </span>{' '}
        para ele neste ciclo; nada será cobrado agora.
      </p>
      <button
        type="button"
        disabled={pending || overdue}
        onClick={onConfirm}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-on-primary)] disabled:opacity-50"
      >
        {pending ? 'Confirmando…' : 'Confirmar com meu crédito'}
      </button>
    </section>
  );
}

function DoneView({
  quote,
  charge,
  onSite,
  usedCredit,
}: {
  quote: CheckoutQuote;
  charge: PaymentCharge | null;
  onSite: boolean;
  usedCredit: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div
        role="status"
        className="rounded-xl bg-[var(--color-success-soft)] px-4 py-4 text-sm text-[var(--color-success)]"
      >
        <p className="text-lg font-semibold text-[var(--color-foreground)]">
          {onSite ? 'Agendamento confirmado' : 'Pagamento em processamento'}
        </p>
        <p>
          {usedCredit
            ? 'Usamos um crédito do seu clube; não houve cobrança. Enviamos os detalhes para o seu WhatsApp.'
            : onSite
              ? 'Enviamos os detalhes para o seu WhatsApp. O pagamento é feito no local.'
              : 'Assim que o pagamento for aprovado, o agendamento é confirmado e você recebe os detalhes.'}
        </p>
      </div>
      <dl className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Serviço</dt>
          <dd className="text-right font-medium">{quote.serviceName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Quando</dt>
          <dd className="text-right font-medium">
            {dateTimeLabel(quote.startsAt, quote.timezone)}
          </dd>
        </div>
        {charge ? (
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-secondary)]">
              {charge.method === 'CARD' ? 'Cartão' : 'Pix'}
            </dt>
            <dd className="text-right font-medium">
              {formatCents(charge.amountCents)}
              {charge.cardLast4 ? ` · •••• ${charge.cardLast4}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
