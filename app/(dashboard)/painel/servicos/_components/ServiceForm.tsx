'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';
import { createServiceAction, updateServiceAction } from '@/lib/catalog/actions';
import { centsToInput } from '@/lib/catalog/money';
import type {
  PaymentMode,
  ServiceFieldErrors,
  ServiceView,
  StaffOption,
} from '@/lib/catalog/types';

/**
 * Formulário de serviço, usado tanto na criação quanto na edição (F2.1).
 *
 * O preço e o sinal viajam como TEXTO: a conversão para centavos acontece no
 * servidor (`lib/catalog/money.ts`). O componente nunca faz `parseFloat` nem
 * aritmética monetária — só coleta e exibe.
 */

const PAYMENT_MODE_OPTIONS: { value: PaymentMode; label: string; hint: string }[] = [
  {
    value: 'ON_SITE',
    label: 'Pagar no local',
    hint: 'O cliente paga no dia do atendimento.',
  },
  {
    value: 'DEPOSIT',
    label: 'Sinal',
    hint: 'O cliente paga uma parte agora e o restante no local.',
  },
  {
    value: 'FULL_PREPAID',
    label: 'Pagamento total antecipado',
    hint: 'O cliente paga o valor cheio ao agendar.',
  },
];

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

interface ServiceFormProps {
  mode: 'create' | 'edit';
  serviceId?: string;
  initial?: ServiceView;
  staff: StaffOption[];
}

export function ServiceForm({ mode, serviceId, initial, staff }: ServiceFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? '');
  const [durationMin, setDurationMin] = useState(String(initial?.durationMin ?? 30));
  const [bufferMin, setBufferMin] = useState(String(initial?.bufferMin ?? 0));
  const [price, setPrice] = useState(centsToInput(initial?.priceCents ?? 0));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initial?.paymentMode ?? 'ON_SITE');
  const [depositMode, setDepositMode] = useState<'NONE' | 'CENTS' | 'PERCENT'>(
    initial?.depositCents != null
      ? 'CENTS'
      : initial?.depositPercent != null
        ? 'PERCENT'
        : 'NONE',
  );
  const [depositValue, setDepositValue] = useState(
    initial?.depositCents != null
      ? centsToInput(initial.depositCents)
      : initial?.depositPercent != null
        ? String(initial.depositPercent)
        : '',
  );
  const [active, setActive] = useState(initial?.active ?? true);
  const [staffIds, setStaffIds] = useState<string[]>(initial?.staffIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ServiceFieldErrors>({});
  const [pending, startTransition] = useTransition();

  function toggleStaff(id: string) {
    setStaffIds((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const input = {
      name,
      durationMin,
      bufferMin,
      price,
      paymentMode,
      depositMode: paymentMode === 'DEPOSIT' ? depositMode : 'NONE',
      depositValue,
      staffIds,
      active,
    };

    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createServiceAction(input)
          : await updateServiceAction(serviceId as string, input);

      if (result.ok) {
        router.push('/painel/servicos' as Route);
        router.refresh();
        return;
      }
      setError(result.message);
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  const selectedMode = PAYMENT_MODE_OPTIONS.find((option) => option.value === paymentMode);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Field label="Nome" htmlFor="service-name" error={fieldErrors.name}>
        <input
          id="service-name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Ex.: Corte masculino"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Duração (min)"
          htmlFor="service-duration"
          error={fieldErrors.durationMin}
        >
          <input
            id="service-duration"
            name="durationMin"
            type="number"
            inputMode="numeric"
            min={5}
            max={720}
            step={5}
            value={durationMin}
            onChange={(event) => setDurationMin(event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Buffer (min)"
          htmlFor="service-buffer"
          error={fieldErrors.bufferMin}
          hint="Intervalo entre atendimentos."
        >
          <input
            id="service-buffer"
            name="bufferMin"
            type="number"
            inputMode="numeric"
            min={0}
            max={240}
            step={5}
            value={bufferMin}
            onChange={(event) => setBufferMin(event.target.value)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field label="Preço" htmlFor="service-price" error={fieldErrors.price}>
        <input
          id="service-price"
          name="price"
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          className={INPUT_CLASS}
          placeholder="50,00"
        />
      </Field>

      <Field
        label="Forma de cobrança"
        htmlFor="service-payment-mode"
        error={fieldErrors.paymentMode}
        hint={selectedMode?.hint}
      >
        <select
          id="service-payment-mode"
          name="paymentMode"
          value={paymentMode}
          onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}
          className={INPUT_CLASS}
        >
          {PAYMENT_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {paymentMode === 'DEPOSIT' ? (
        <fieldset className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4">
          <legend className="px-1 text-sm font-medium">Sinal</legend>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="depositMode"
                value="CENTS"
                checked={depositMode === 'CENTS'}
                onChange={() => setDepositMode('CENTS')}
              />
              Valor fixo (R$)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="depositMode"
                value="PERCENT"
                checked={depositMode === 'PERCENT'}
                onChange={() => setDepositMode('PERCENT')}
              />
              Percentual (%)
            </label>
          </div>

          <Field
            label={depositMode === 'PERCENT' ? 'Percentual do sinal' : 'Valor do sinal'}
            htmlFor="service-deposit"
            error={fieldErrors.deposit}
          >
            <input
              id="service-deposit"
              name="depositValue"
              type="text"
              inputMode="decimal"
              value={depositValue}
              onChange={(event) => setDepositValue(event.target.value)}
              className={INPUT_CLASS}
              placeholder={depositMode === 'PERCENT' ? '30' : '15,00'}
            />
          </Field>
        </fieldset>
      ) : null}

      <fieldset className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">Profissionais habilitados</legend>
        {staff.length === 0 ? (
          <p className="text-sm text-[var(--color-secondary)]">
            Nenhum profissional cadastrado ainda. Você pode habilitar depois, em Equipe.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {staff.map((profile) => (
              <label key={profile.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={staffIds.includes(profile.id)}
                  onChange={() => toggleStaff(profile.id)}
                />
                <span>{profile.name}</span>
                {!profile.active ? (
                  <span className="text-xs text-[var(--color-secondary)]">(inativo)</span>
                ) : null}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Serviço ativo no portal
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Salvando…' : mode === 'create' ? 'Criar serviço' : 'Salvar alterações'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/painel/servicos' as Route)}
          className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
