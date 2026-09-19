'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveOnboardingPortalAction } from '../actions';
import type { PortalAddressField } from '@/app/(dashboard)/painel/configuracoes/validation';

/**
 * Passo 4 — link do portal (tarefa F2.5).
 *
 * O endereço é salvo pela action da F2.4 (`savePortalAddressAction`), reusada
 * pela action do onboarding: slug reservado e slug já usado por outro tenant
 * continuam recusados com a MESMA regra. Aqui só há o campo de slug — domínio
 * próprio é assunto do plano Pro, não do primeiro minuto do salão.
 */
export function PortalStep({
  initialSlug,
  appDomain,
}: {
  initialSlug: string;
  appDomain: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initialSlug);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PortalAddressField, string>>>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await saveOnboardingPortalAction({ slug, customDomain: null });
      if (result.ok) {
        router.push('/painel/onboarding/pronto' as Route);
        router.refresh();
        return;
      }
      setError(result.message);
      if ('fieldErrors' in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="onboarding-slug" className="text-sm font-medium">
          Endereço do portal
        </label>
        <input
          id="onboarding-slug"
          name="slug"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]"
          placeholder="seu-salao"
        />
        {fieldErrors.slug ? (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {fieldErrors.slug}
          </p>
        ) : (
          <p className="text-xs text-[var(--color-secondary)]">
            Seu portal fica em {appDomain}/{slug || 'seu-endereco'}
          </p>
        )}
      </div>

      {error && !fieldErrors.slug ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Gerando…' : 'Gerar link do portal'}
        </button>
      </div>
    </form>
  );
}
