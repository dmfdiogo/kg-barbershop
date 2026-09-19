'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { saveEstablishmentAction, type EstablishmentActionResult } from '../actions';
import type { EstablishmentFieldErrors } from '../validation';

/**
 * Passo 1 — dados do estabelecimento (tarefa F2.5).
 *
 * Coleta nome, CPF/CNPJ e chave Pix. A gravação é feita pela action do
 * onboarding; a validação de verdade roda no servidor e volta campo a campo.
 * Ao concluir, avança para o passo de expediente.
 */

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]';

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

export function EstablishmentStep({
  initialName,
  initialDocument,
  initialPixKey,
  payoutAwaitingActivation,
}: {
  initialName: string;
  initialDocument: string;
  initialPixKey: string;
  payoutAwaitingActivation: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [document, setDocument] = useState(initialDocument);
  const [pixKey, setPixKey] = useState(initialPixKey);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EstablishmentFieldErrors>({});
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    startTransition(async () => {
      const result: EstablishmentActionResult = await saveEstablishmentAction({
        name,
        document,
        pixKey,
      });

      if (result.ok) {
        router.push('/painel/onboarding/horario' as Route);
        router.refresh();
        return;
      }
      setError(result.message);
      if (result.code === 'INVALID') setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Field label="Nome do estabelecimento" htmlFor="onboarding-name" error={fieldErrors.name}>
        <input
          id="onboarding-name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Ex.: Barbearia do Carlos"
        />
      </Field>

      <Field
        label="CPF ou CNPJ"
        htmlFor="onboarding-document"
        error={fieldErrors.document}
        hint="É o documento que vai identificar a conta de recebimento."
      >
        <input
          id="onboarding-document"
          name="document"
          type="text"
          inputMode="numeric"
          value={document}
          onChange={(event) => setDocument(event.target.value)}
          className={INPUT_CLASS}
          placeholder="00.000.000/0000-00"
        />
      </Field>

      <Field
        label="Chave Pix"
        htmlFor="onboarding-pix"
        error={fieldErrors.pixKey}
        hint="Onde você quer receber os valores dos atendimentos."
      >
        <input
          id="onboarding-pix"
          name="pixKey"
          type="text"
          value={pixKey}
          onChange={(event) => setPixKey(event.target.value)}
          className={INPUT_CLASS}
          placeholder="seu@email.com, telefone ou chave aleatória"
        />
      </Field>

      {payoutAwaitingActivation ? (
        <p
          role="status"
          className="rounded-lg border border-[var(--color-warning)] px-3 py-2 text-xs text-[var(--color-warning)]"
        >
          Recebimento: aguardando ativação. Você já pode usar o sistema cobrando no local
          enquanto a conta é aprovada.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : 'Salvar e continuar'}
        </button>
      </div>
    </form>
  );
}
