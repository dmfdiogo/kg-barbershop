'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { inviteStaffAction } from '@/lib/staffing/actions';
import type { StaffFieldErrors } from '@/lib/staffing/types';

/**
 * Convite de membro por telefone (tarefa F2.2).
 *
 * Não existe senha no sistema: o convite cria `TenantMember` com papel STAFF e
 * a pessoa entra pelo MESMO OTP dos clientes. O nome é opcional — sem ele, o
 * telefone vira o nome provisório até o primeiro acesso.
 */
const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]';

export function InviteForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await inviteStaffAction({ name, phone });
      if (result.ok) {
        setName('');
        setPhone('');
        router.refresh();
        return;
      }
      setError(result.message);
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Convidar profissional</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          A pessoa acessa com o mesmo código enviado no WhatsApp, sem senha.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-name" className="text-sm font-medium">
            Nome (opcional)
          </label>
          <input
            id="invite-name"
            name="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Ex.: Bruna Alencar"
          />
          {fieldErrors.name ? (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {fieldErrors.name}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-phone" className="text-sm font-medium">
            WhatsApp
          </label>
          <input
            id="invite-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={INPUT_CLASS}
            placeholder="+5548999999999"
          />
          {fieldErrors.phone ? (
            <p role="alert" className="text-xs text-[var(--color-danger)]">
              {fieldErrors.phone}
            </p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Convidando…' : 'Convidar'}
        </button>
      </div>
    </form>
  );
}
