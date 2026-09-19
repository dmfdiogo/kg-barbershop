'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestOtpAction, verifyOtpAction } from '@/lib/auth/actions';
import { normalizePhoneToE164 } from '@/app/(auth)/_lib/phone';

/**
 * Identificação do cliente na área logada (F3.4).
 *
 * Reusa as mesmas server actions do fluxo de agendamento e das telas de login:
 * não existe senha no produto (spec §2.4), só OTP por WhatsApp. Aqui o login
 * vem no COMEÇO — diferente do agendamento, em que ele fica no fim para não
 * derrubar conversão. Quem abre "Meus agendamentos" já quer se identificar.
 */

type Stage = 'phone' | 'code';

export function AccountLogin({ basePath }: { basePath: string }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('phone');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [e164, setE164] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Informe o seu nome.');
      return;
    }
    const normalized = normalizePhoneToE164(phone);
    if (!normalized) {
      setError('Informe o WhatsApp com DDD. Ex.: (48) 99999-9999.');
      return;
    }
    startTransition(async () => {
      const result = await requestOtpAction({ name: trimmedName, phone: normalized });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setE164(normalized);
      setCode('');
      setStage('code');
      setInfo('Enviamos um código de 6 dígitos para o seu WhatsApp.');
    });
  }

  function handleVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (code.length !== 6) {
      setError('Digite os 6 dígitos do código.');
      return;
    }
    startTransition(async () => {
      const result = await verifyOtpAction({ phone: e164, code });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // A sessão agora existe: o Server Component recarrega e mostra os
      // agendamentos do cliente recém-identificado.
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Meus agendamentos</h1>
        <p className="text-sm text-[var(--color-secondary)]">
          Entre com o seu WhatsApp para ver e gerenciar os seus horários.
        </p>
      </header>

      {stage === 'phone' ? (
        <form onSubmit={handleRequest} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="account-name" className="text-sm font-medium">
              Nome
            </label>
            <input
              id="account-name"
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
            <label htmlFor="account-phone" className="text-sm font-medium">
              WhatsApp
            </label>
            <input
              id="account-phone"
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
          </div>
          {error ? <ErrorLine message={error} /> : null}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
          >
            {pending ? 'Enviando código…' : 'Receber código'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="flex flex-col gap-4" noValidate>
          <h2 className="text-base font-semibold">Digite o código</h2>
          {info ? (
            <p
              role="status"
              className="rounded-lg bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
            >
              {info}
            </p>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="account-code" className="text-sm font-medium">
              Código
            </label>
            <input
              id="account-code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          {error ? <ErrorLine message={error} /> : null}
          <button
            type="submit"
            disabled={pending || code.length !== 6}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
          >
            {pending ? 'Verificando…' : 'Entrar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage('phone');
              setError(null);
              setInfo(null);
            }}
            className="text-center text-xs text-[var(--color-secondary)] underline"
          >
            Trocar o número
          </button>
        </form>
      )}

      <a href={basePath || '/'} className="text-center text-sm text-[var(--color-secondary)] underline">
        Voltar ao início
      </a>
    </section>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
    >
      {message}
    </p>
  );
}
