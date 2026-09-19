'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { savePortalAddressAction } from '../actions';
import type { PortalAddressField } from '../validation';
import type { PortalSettings } from '../service';

/**
 * Formulário do endereço do portal (tarefa F2.4).
 *
 * O domínio próprio só é editável no plano Pro; fora dele o campo aparece
 * desabilitado (o provisionamento de DNS/SSL é fase 2 do produto). Um domínio
 * já gravado nunca é enviado quando o tenant não é Pro, para não ser apagado
 * como efeito colateral de salvar o slug.
 */

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60';

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-[var(--color-secondary)]">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function PortalAddressForm({
  initial,
  appDomain,
}: {
  initial: PortalSettings;
  appDomain: string;
}) {
  const router = useRouter();
  const [slug, setSlug] = useState(initial.slug);
  const [customDomain, setCustomDomain] = useState(initial.customDomain ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PortalAddressField, string>>>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setFieldErrors({});

    startTransition(async () => {
      const result = await savePortalAddressAction({
        slug,
        customDomain: initial.isPro ? customDomain : null,
      });

      if (result.ok) {
        setSaved(true);
        router.refresh();
        return;
      }
      setError(result.message);
      if ('fieldErrors' in result && result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-5 rounded-xl border border-[var(--color-border)] p-5"
      noValidate
    >
      <div>
        <h2 className="text-base font-semibold">Endereço do portal</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          É o link que o cliente abre para agendar.
        </p>
      </div>

      <Field
        label="Endereço (slug)"
        htmlFor="slug"
        error={fieldErrors.slug}
        hint={`Seu portal fica em ${appDomain}/${slug || 'seu-endereco'}`}
      >
        <input
          id="slug"
          name="slug"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className={INPUT_CLASS}
          placeholder="seu-salao"
        />
      </Field>

      <Field
        label="Domínio próprio"
        htmlFor="customDomain"
        error={fieldErrors.customDomain}
        hint={
          initial.isPro
            ? 'O provisionamento de DNS e SSL entra na fase 2 do produto.'
            : 'Disponível a partir do plano Pro.'
        }
      >
        <input
          id="customDomain"
          name="customDomain"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={customDomain}
          onChange={(event) => setCustomDomain(event.target.value)}
          disabled={!initial.isPro}
          className={INPUT_CLASS}
          placeholder="www.seusalao.com.br"
        />
      </Field>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : 'Salvar endereço'}
        </button>
        {saved ? (
          <span role="status" className="text-sm text-[var(--color-success)]">
            Endereço atualizado.
          </span>
        ) : null}
      </div>

      {error && !Object.keys(fieldErrors).length ? (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
