'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestOtpAction, verifyOtpAction } from '@/lib/auth/actions';
import { normalizePhoneToE164 } from '@/app/(auth)/_lib/phone';
import { checkoutHref } from '@/components/portal/paths';
import { confirmBookingAction, createHoldAction, loadAvailabilityAction } from '../actions';
import {
  countdownLabel,
  formatCents,
  formatDuration,
  paymentModeLabel,
} from '../_lib/format';
import type { BookingOptions, ConfirmedInfo, HoldInfo, SlotOption } from '../_lib/types';

/**
 * Fluxo de agendamento do portal (F3.3): serviço → profissional (ou "qualquer
 * um") → dia/horário → hold → OTP no FIM → confirmação.
 *
 * Mobile-first e sem cor literal: tudo por token do tenant. O estado vive aqui
 * — e não em cada etapa — para que a expiração do hold durante o OTP preserve o
 * nome e o WhatsApp já digitados (requisito explícito da tarefa).
 *
 * O OTP vem no fim de propósito: pedir login antes de mostrar horário derruba
 * conversão. Quando o formulário de código aparece, o hold de 10 minutos já
 * existe no banco (criação em `createHoldAction`).
 */

type Step = 'staff' | 'slot' | 'identify' | 'done';
type OtpStage = 'phone' | 'code';

const ANY_STAFF = '__any__';

export function BookingFlow({
  basePath,
  options,
}: {
  basePath: string;
  options: BookingOptions;
}) {
  const { service, staff, dates, timezone } = options;
  const router = useRouter();

  const [step, setStep] = useState<Step>('staff');
  const [staffChoice, setStaffChoice] = useState<string | null>(null);
  const [date, setDate] = useState<string>(dates[0]?.date ?? '');
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [slotsLoading, startSlots] = useTransition();
  const [slotsError, setSlotsError] = useState<string | null>(null);

  const [hold, setHold] = useState<HoldInfo | null>(null);
  const [holdLost, setHoldLost] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otpStage, setOtpStage] = useState<OtpStage>('phone');
  const [code, setCode] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpInfo, setOtpInfo] = useState<string | null>(null);
  const [pendingOtp, startOtp] = useTransition();
  const [confirming, startConfirm] = useTransition();

  const [confirmed, setConfirmed] = useState<ConfirmedInfo | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const submittingRef = useRef(false);

  const staffParam = staffChoice === ANY_STAFF ? null : staffChoice;

  const loadSlots = useCallback(
    (targetDate: string, staffId: string | null) => {
      setSlotsError(null);
      startSlots(async () => {
        const result = await loadAvailabilityAction({
          serviceId: service.id,
          staffId,
          date: targetDate,
        });
        if (result.ok) {
          setSlots(result.value);
          return;
        }
        setSlots([]);
        setSlotsError(result.message);
      });
    },
    [service.id],
  );

  function chooseStaff(choice: string) {
    setStaffChoice(choice);
    setStep('slot');
    loadSlots(date, choice === ANY_STAFF ? null : choice);
  }

  function chooseDate(nextDate: string) {
    setDate(nextDate);
    loadSlots(nextDate, staffParam);
  }

  function chooseSlot(slot: SlotOption) {
    if (creating) return;
    setCreateError(null);
    startCreate(async () => {
      const result = await createHoldAction({
        serviceId: service.id,
        staffId: staffParam,
        startsAt: slot.value,
      });
      if (!result.ok) {
        setCreateError(result.message);
        // Slot tomado por outra pessoa: recarrega a grade, nunca 500.
        loadSlots(date, staffParam);
        return;
      }
      setHold(result.value);
      setHoldLost(false);
      setOtpStage('phone');
      setCode('');
      setOtpError(null);
      setOtpInfo(null);
      setStep('identify');
    });
  }

  // Contador do hold. É INFORMATIVO: os 10 minutos são a garantia de
  // exclusividade, não um prazo de validade. Enquanto a linha existir, a
  // exclusion constraint mantém o slot bloqueado e o servidor aceita confirmar,
  // mesmo com o contador zerado. Só quando a linha sumiu (a limpeza de outro
  // hold a recolheu) o servidor devolve BOOKING_NOT_FOUND e a UI recupera.
  useEffect(() => {
    if (!hold || step !== 'identify' || holdLost) return;
    const expiresAt = Date.parse(hold.expiresAt);
    const tick = () => setRemainingMs(expiresAt - Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [hold, step, holdLost]);

  function handleRequestOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOtpError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setOtpError('Informe o seu nome.');
      return;
    }
    const e164 = normalizePhoneToE164(phone);
    if (!e164) {
      setOtpError('Informe o WhatsApp com DDD. Ex.: (48) 99999-9999.');
      return;
    }
    startOtp(async () => {
      const result = await requestOtpAction({ name: trimmedName, phone: e164 });
      if (!result.ok) {
        setOtpError(result.message);
        return;
      }
      setPhone(e164);
      setOtpStage('code');
      setOtpInfo('Enviamos um código de 6 dígitos para o seu WhatsApp.');
    });
  }

  function handleVerifyOtp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hold) return;
    setOtpError(null);
    if (code.length !== 6) {
      setOtpError('Digite os 6 dígitos do código.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;

    const e164 = normalizePhoneToE164(phone) ?? phone;
    startOtp(async () => {
      const verified = await verifyOtpAction({ phone: e164, code });
      if (!verified.ok) {
        submittingRef.current = false;
        setOtpError(verified.message);
        return;
      }
      // Serviço com pagamento online (integral ou sinal): o hold segue HOLD e o
      // checkout assume a cobrança. A confirmação só vem com o pagamento
      // aprovado (webhook da F4.0).
      if (service.paymentMode !== 'ON_SITE') {
        submittingRef.current = false;
        router.push(checkoutHref(basePath, hold.holdId) as Parameters<typeof router.push>[0]);
        return;
      }
      startConfirm(async () => {
        const result = await confirmBookingAction({ holdId: hold.holdId });
        submittingRef.current = false;
        if (result.ok) {
          setConfirmed(result.value);
          setStep('done');
          return;
        }
        if (result.code === 'BOOKING_NOT_FOUND') {
          setHoldLost(true);
          return;
        }
        setOtpError(result.message);
      });
    });
  }

  function handleDirectConfirm() {
    if (!hold || submittingRef.current) return;
    if (service.paymentMode !== 'ON_SITE') {
      router.push(checkoutHref(basePath, hold.holdId) as Parameters<typeof router.push>[0]);
      return;
    }
    submittingRef.current = true;
    startConfirm(async () => {
      const result = await confirmBookingAction({ holdId: hold.holdId });
      submittingRef.current = false;
      if (result.ok) {
        setConfirmed(result.value);
        setStep('done');
        return;
      }
      if (result.code === 'BOOKING_NOT_FOUND') {
        setHoldLost(true);
        return;
      }
      setOtpError(result.message);
    });
  }

  function pickAnotherSlot() {
    setHold(null);
    setHoldLost(false);
    setCode('');
    setOtpError(null);
    setOtpInfo(null);
    setOtpStage('phone');
    setStep('slot');
    loadSlots(date, staffParam);
  }

  if (step === 'done' && confirmed) {
    return <ConfirmationView confirmed={confirmed} basePath={basePath} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-[var(--color-secondary)]">
          {formatDuration(service.durationMin)} · {paymentModeLabel(service)}
        </p>
        <h1 className="text-xl font-semibold">{service.name}</h1>
        <p className="text-sm text-[var(--color-secondary)]">
          {formatCents(service.priceCents)}
        </p>
      </header>

      <Steps step={step} />

      {step === 'staff' && (
        <section className="flex flex-col gap-3" aria-labelledby="passo-profissional">
          <h2 id="passo-profissional" className="text-base font-semibold">
            Escolha o profissional
          </h2>
          <button
            type="button"
            onClick={() => chooseStaff(ANY_STAFF)}
            className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-left transition-colors hover:border-[var(--color-primary)]"
          >
            <span className="block text-sm font-semibold">Qualquer profissional</span>
            <span className="block text-xs text-[var(--color-secondary)]">
              Mostramos os horários de todos
            </span>
          </button>
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => chooseStaff(member.id)}
              className="rounded-xl border border-[var(--color-border)] px-4 py-3 text-left text-sm font-medium transition-colors hover:border-[var(--color-primary)]"
            >
              {member.name}
            </button>
          ))}
        </section>
      )}

      {step === 'slot' && (
        <section className="flex flex-col gap-4" aria-labelledby="passo-horario">
          <div className="flex items-center justify-between gap-2">
            <h2 id="passo-horario" className="text-base font-semibold">
              Escolha o horário
            </h2>
            <button
              type="button"
              onClick={() => setStep('staff')}
              className="text-xs text-[var(--color-secondary)] underline"
            >
              Trocar profissional
            </button>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {dates.map((day) => {
              const selected = day.date === date;
              return (
                <button
                  key={day.date}
                  type="button"
                  onClick={() => chooseDate(day.date)}
                  aria-pressed={selected}
                  className={`flex min-w-16 flex-col items-center rounded-xl border px-3 py-2 text-sm ${
                    selected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                      : 'border-[var(--color-border)] text-[var(--color-foreground)]'
                  }`}
                >
                  <span className="text-xs capitalize">{day.weekday}</span>
                  <span className="font-semibold">{day.dayMonth}</span>
                </button>
              );
            })}
          </div>

          {createError ? (
            <p
              role="alert"
              className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {createError}
            </p>
          ) : null}

          {slotsError ? (
            <p
              role="alert"
              className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
            >
              {slotsError}
            </p>
          ) : null}

          {slotsLoading ? (
            <p className="text-sm text-[var(--color-secondary)]">Carregando horários…</p>
          ) : slots.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-secondary)]">
              Nenhum horário livre neste dia. Tente outra data.
            </p>
          ) : (
            <ul className="grid grid-cols-3 gap-2">
              {slots.map((slot) => (
                <li key={slot.value}>
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => chooseSlot(slot)}
                    className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium transition-colors hover:border-[var(--color-primary)] disabled:opacity-60"
                  >
                    {slot.label}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {creating ? (
            <p className="text-sm text-[var(--color-secondary)]">Reservando seu horário…</p>
          ) : null}
        </section>
      )}

      {step === 'identify' && hold && (
        <section className="flex flex-col gap-4" aria-labelledby="passo-identificacao">
          <HoldSummary hold={hold} timezone={timezone} />

          {holdLost ? (
            <div
              role="alert"
              className="flex flex-col gap-3 rounded-lg bg-[var(--color-warning-soft)] px-3 py-3 text-sm text-[var(--color-warning)]"
            >
              <p className="font-medium">Seu horário foi liberado.</p>
              <p>
                A reserva saiu do sistema e outra pessoa pode ter ficado com o
                horário. Você não perdeu o que digitou — é só escolher de novo.
              </p>
              <button
                type="button"
                onClick={pickAnotherSlot}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-primary-foreground)]"
              >
                Escolher outro horário
              </button>
            </div>
          ) : (
            <HoldCountdown remainingMs={remainingMs} />
          )}

          {!holdLost && hold.authenticated && (
            <div className="flex flex-col gap-4">
              <h2 id="passo-identificacao" className="text-base font-semibold">
                Confirmar agendamento
              </h2>
              <p className="text-sm text-[var(--color-secondary)]">
                Você já está identificado. É só confirmar.
              </p>
              {otpError ? <OtpError message={otpError} /> : null}
              <button
                type="button"
                onClick={handleDirectConfirm}
                disabled={confirming}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
              >
                {confirming ? 'Confirmando…' : 'Confirmar agendamento'}
              </button>
            </div>
          )}

          {!holdLost && !hold.authenticated && otpStage === 'phone' && (
            <form onSubmit={handleRequestOtp} className="flex flex-col gap-4" noValidate>
              <h2 id="passo-identificacao" className="text-base font-semibold">
                Confirme com o seu WhatsApp
              </h2>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="agenda-name" className="text-sm font-medium">
                  Nome
                </label>
                <input
                  id="agenda-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  enterKeyHint="next"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-base outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="agenda-phone" className="text-sm font-medium">
                  WhatsApp
                </label>
                <input
                  id="agenda-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  enterKeyHint="send"
                  placeholder="(48) 99999-9999"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-base outline-none focus:border-[var(--color-primary)]"
                />
                <p className="text-xs text-[var(--color-secondary)]">
                  Enviaremos um código de 6 dígitos para confirmar. Não há senha.
                </p>
              </div>
              {otpError ? <OtpError message={otpError} /> : null}
              <button
                type="submit"
                disabled={pendingOtp}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
              >
                {pendingOtp ? 'Enviando código…' : 'Receber código'}
              </button>
            </form>
          )}

          {!holdLost && !hold.authenticated && otpStage === 'code' && (
            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-4" noValidate>
              <h2 id="passo-identificacao" className="text-base font-semibold">
                Digite o código
              </h2>
              {otpInfo ? (
                <p
                  role="status"
                  className="rounded-lg bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
                >
                  {otpInfo}
                </p>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="agenda-code" className="text-sm font-medium">
                  Código
                </label>
                <input
                  id="agenda-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  maxLength={6}
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-[var(--color-primary)]"
                />
              </div>
              {otpError ? <OtpError message={otpError} /> : null}
              <button
                type="submit"
                disabled={pendingOtp || confirming || code.length !== 6}
                className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
              >
                {confirming ? 'Confirmando…' : 'Confirmar agendamento'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOtpStage('phone');
                  setOtpError(null);
                  setOtpInfo(null);
                }}
                className="text-center text-xs text-[var(--color-secondary)] underline"
              >
                Trocar o número
              </button>
            </form>
          )}
        </section>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const labels: Array<{ key: Step; label: string }> = [
    { key: 'staff', label: 'Profissional' },
    { key: 'slot', label: 'Horário' },
    { key: 'identify', label: 'Confirmação' },
  ];
  const activeIndex = labels.findIndex((item) => item.key === step);
  return (
    <ol className="flex items-center gap-2 text-xs text-[var(--color-secondary)]">
      {labels.map((item, index) => (
        <li key={item.key} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              index <= activeIndex
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]'
                : 'border-[var(--color-border)]'
            }`}
          >
            {index + 1}
          </span>
          <span className={index <= activeIndex ? 'text-[var(--color-foreground)]' : undefined}>
            {item.label}
          </span>
          {index < labels.length - 1 ? <span aria-hidden>·</span> : null}
        </li>
      ))}
    </ol>
  );
}

function HoldCountdown({ remainingMs }: { remainingMs: number }) {
  const overdue = remainingMs <= 0;
  const urgent = remainingMs <= 2 * 60 * 1000;
  return (
    <p
      role="timer"
      className={`rounded-lg px-3 py-2 text-sm ${
        urgent
          ? 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]'
          : 'bg-[var(--color-muted)] text-[var(--color-secondary)]'
      }`}
    >
      {overdue ? (
        <>
          Tempo de exclusividade encerrado. O horário segue reservado para você —
          é só concluir.
        </>
      ) : (
        <>
          Tempo para concluir:{' '}
          <span className="font-mono font-semibold text-[var(--color-foreground)]">
            {countdownLabel(remainingMs)}
          </span>
        </>
      )}
    </p>
  );
}

function HoldSummary({ hold, timezone }: { hold: HoldInfo; timezone: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] p-4 text-sm">
      <p className="font-semibold">{hold.service.name}</p>
      <p className="text-[var(--color-secondary)]">{hold.startsAtLabel}</p>
      <p className="text-[var(--color-secondary)]">com {hold.staffName}</p>
      <p className="text-[var(--color-secondary)]">
        {hold.service.durationMin} min · {timezone}
      </p>
    </div>
  );
}

function OtpError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
    >
      {message}
    </p>
  );
}

function ConfirmationView({
  confirmed,
  basePath,
}: {
  confirmed: ConfirmedInfo;
  basePath: string;
}) {
  const { hold } = confirmed;
  return (
    <section className="flex flex-col gap-4">
      <div
        role="status"
        className="rounded-xl bg-[var(--color-success-soft)] px-4 py-4 text-sm text-[var(--color-success)]"
      >
        <p className="text-lg font-semibold text-[var(--color-foreground)]">
          Agendamento confirmado
        </p>
        <p>Enviamos os detalhes para o seu WhatsApp.</p>
      </div>
      <dl className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] p-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Serviço</dt>
          <dd className="text-right font-medium">{hold.service.name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Quando</dt>
          <dd className="text-right font-medium">{hold.startsAtLabel}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Profissional</dt>
          <dd className="text-right font-medium">{hold.staffName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--color-secondary)]">Valor</dt>
          <dd className="text-right font-medium">{formatCents(hold.service.priceCents)}</dd>
        </div>
      </dl>
      <a
        href={basePath || '/'}
        className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-center text-sm font-semibold"
      >
        Voltar ao início
      </a>
    </section>
  );
}
