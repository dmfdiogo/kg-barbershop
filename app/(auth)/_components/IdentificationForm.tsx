'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestOtpAction } from '@/lib/auth/actions';
import { normalizePhoneToE164 } from '../_lib/phone';
import { withNext } from '../_lib/routes';
import { formatCooldown, useCooldown } from './use-cooldown';

/**
 * Tela de identificação (F1.2): nome + WhatsApp, nenhuma senha — ela não existe
 * no produto (spec §2.4). O formulário normaliza o telefone para E.164 antes de
 * chamar a server action e, no sucesso, leva para a tela do código preservando
 * o `next`.
 */
export function IdentificationForm({
  codeHref,
  nextPath,
}: {
  codeHref: string;
  nextPath: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cooldown = useCooldown(0);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('Informe o seu nome.');
      return;
    }

    const e164 = normalizePhoneToE164(phone);
    if (!e164) {
      setError('Informe o WhatsApp com DDD. Ex.: (48) 99999-9999.');
      return;
    }

    startTransition(async () => {
      const result = await requestOtpAction({ name: trimmedName, phone: e164 });
      if (result.ok) {
        const destination = withNext(codeHref, nextPath);
        router.push(destination as Parameters<typeof router.push>[0]);
        return;
      }
      setError(result.message);
      if (result.retryAfterSeconds !== undefined) {
        cooldown.setSeconds(result.retryAfterSeconds);
      }
    });
  }

  const blocked = pending || cooldown.seconds > 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="auth-name" className="text-sm font-medium">
          Nome
        </label>
        <input
          id="auth-name"
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
        <label htmlFor="auth-phone" className="text-sm font-medium">
          WhatsApp
        </label>
        <input
          id="auth-phone"
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
          Enviaremos um código de 6 dígitos por WhatsApp.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
          {cooldown.seconds > 0 ? ` Aguarde ${formatCooldown(cooldown.seconds)}.` : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={blocked}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-base font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? 'Enviando código…' : 'Receber código'}
      </button>
    </form>
  );
}
