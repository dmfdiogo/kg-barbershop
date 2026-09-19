'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestOtpAction, verifyOtpAction } from '@/lib/auth/actions';
import { resolveNextPath } from '../_lib/redirect';
import { formatCooldown, useCooldown } from './use-cooldown';

/**
 * Tela do código (F1.2). Cobre os quatro caminhos de erro que a F1.1 devolve em
 * pt-BR — expirado, errado (com tentativas restantes), tentativas esgotadas e
 * rate limit — além do reenvio com cooldown visível.
 *
 * O telefone e o nome chegam do cookie pendente assinado, lidos no servidor: o
 * nome nunca reenviado pelo cliente, e a tela não depende de query string com
 * dado pessoal.
 */
export function OtpCodeForm({
  phone,
  displayPhone,
  name,
  identifyHref,
  nextPath,
  basePath,
  cooldownSeconds,
}: {
  phone: string;
  displayPhone: string;
  name: string;
  identifyHref: string;
  nextPath: string | null;
  basePath: string;
  cooldownSeconds: number;
}) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [pending, startTransition] = useTransition();
  const cooldown = useCooldown(cooldownSeconds);

  function handleCodeChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCode(event.target.value.replace(/\D/g, '').slice(0, 6));
    setError(null);
    setRemainingAttempts(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (code.length !== 6) {
      setError('Digite os 6 dígitos do código.');
      return;
    }

    startTransition(async () => {
      const result = await verifyOtpAction({ phone, code });
      if (result.ok) {
        const destination = resolveNextPath(nextPath, result.role, basePath);
        router.replace(destination as Parameters<typeof router.replace>[0]);
        router.refresh();
        return;
      }
      setError(result.message);
      setRemainingAttempts(result.remainingAttempts ?? null);
      setInfo(null);
    });
  }

  async function handleResend() {
    if (cooldown.seconds > 0 || resending || pending) return;
    setResending(true);
    setError(null);
    setRemainingAttempts(null);
    setInfo(null);

    const result = await requestOtpAction({ name, phone });
    setResending(false);
    if (result.ok) {
      setCode('');
      setInfo('Enviamos um novo código para o seu WhatsApp.');
      cooldown.setSeconds(cooldownSeconds);
      return;
    }
    setError(result.message);
    if (result.retryAfterSeconds !== undefined) {
      cooldown.setSeconds(result.retryAfterSeconds);
    }
  }

  const resendDisabled = cooldown.seconds > 0 || resending || pending;
  const submitDisabled = pending || code.length !== 6;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--color-secondary)]">
        Enviamos um código de 6 dígitos para{' '}
        <span className="font-medium text-[var(--color-foreground)]">{displayPhone}</span>.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-code" className="text-sm font-medium">
            Código
          </label>
          <input
            id="auth-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            maxLength={6}
            aria-describedby={error ? 'auth-code-error' : undefined}
            value={code}
            onChange={handleCodeChange}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] outline-none focus:border-[var(--color-primary)]"
          />
        </div>

        {error ? (
          <p
            id="auth-code-error"
            role="alert"
            className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {error}
            {remainingAttempts !== null && remainingAttempts > 0
              ? ` Restam ${remainingAttempts} tentativa${remainingAttempts === 1 ? '' : 's'}.`
              : null}
          </p>
        ) : null}

        {info ? (
          <p
            role="status"
            className="rounded-lg bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          >
            {info}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Verificando…' : 'Entrar'}
        </button>
      </form>

      <div className="flex flex-col gap-2 text-sm">
        <button
          type="button"
          onClick={handleResend}
          disabled={resendDisabled}
          className="rounded-lg border border-[var(--color-border)] px-4 py-3 font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {resending
            ? 'Reenviando…'
            : cooldown.seconds > 0
              ? `Reenviar código em ${formatCooldown(cooldown.seconds)}`
              : 'Reenviar código'}
        </button>

        <a href={identifyHref} className="text-center text-[var(--color-secondary)] underline">
          Trocar o número
        </a>
      </div>
    </div>
  );
}
