'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type ReactNode } from 'react';
import { centsToInput } from '@/lib/catalog/money';
import {
  createPlanAction,
  updatePlanAction,
} from '@/app/(dashboard)/painel/clube/actions';
import {
  BENEFIT_QUANTITY_MAX,
  BENEFIT_QUANTITY_MIN,
  MEMBERSHIP_CYCLES,
  MEMBERSHIP_CYCLE_LABELS,
  type MembershipCycle,
  type MembershipPlanFieldErrors,
  type MembershipPlanView,
  type PlanServiceOption,
} from '@/lib/membership/plans';

/**
 * Formulário de plano do clube, usado na criação e na edição (F5.0).
 *
 * O preço viaja como TEXTO: a conversão para centavos acontece no servidor
 * (`lib/catalog/money.ts`). O componente só coleta e exibe — nada de float.
 *
 * Cada linha de benefício é um par serviço × quantidade por ciclo. As opções de
 * serviço vêm do PRÓPRIO tenant (carregadas na página); a action revalida a
 * origem de qualquer forma, porque a tela não é autorização.
 */

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-primary)]';

const PLANS_PATH = '/painel/clube/planos';

interface BenefitRow {
  key: string;
  serviceId: string;
  quantity: string;
}

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

interface PlanFormProps {
  mode: 'create' | 'edit';
  planId?: string;
  initial?: MembershipPlanView;
  services: PlanServiceOption[];
}

export function PlanForm({ mode, planId, initial, services }: PlanFormProps) {
  const router = useRouter();
  // O contador só é lido em handler (adicionar linha), nunca durante o render.
  const nextKey = useRef(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [price, setPrice] = useState(centsToInput(initial?.priceCents ?? 0));
  const [cycle, setCycle] = useState<MembershipCycle>(initial?.cycle ?? 'MONTHLY');
  const [active, setActive] = useState(initial?.active ?? true);
  const [benefits, setBenefits] = useState<BenefitRow[]>(() =>
    (initial?.benefits ?? []).map((benefit, index) => ({
      key: `initial-${index}`,
      serviceId: benefit.serviceId,
      quantity: String(benefit.quantityPerCycle),
    })),
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MembershipPlanFieldErrors>({});
  const [pending, startTransition] = useTransition();

  function addBenefit() {
    setBenefits((current) => [
      ...current,
      { key: `new-${nextKey.current++}`, serviceId: '', quantity: '1' },
    ]);
  }

  function removeBenefit(key: string) {
    setBenefits((current) => current.filter((row) => row.key !== key));
  }

  function updateBenefit(key: string, patch: Partial<Omit<BenefitRow, 'key'>>) {
    setBenefits((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    const input = {
      name,
      price,
      cycle,
      active,
      benefits: benefits
        .filter((row) => row.serviceId.length > 0)
        .map((row) => ({ serviceId: row.serviceId, quantityPerCycle: row.quantity })),
    };

    startTransition(async () => {
      const result =
        mode === 'create'
          ? await createPlanAction(input)
          : await updatePlanAction(planId as string, input);

      if (result.ok) {
        router.push(PLANS_PATH as Route);
        router.refresh();
        return;
      }
      setError(result.message);
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Field label="Nome" htmlFor="plan-name" error={fieldErrors.name}>
        <input
          id="plan-name"
          name="name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={INPUT_CLASS}
          placeholder="Ex.: Clube 2 cortes/mês"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Preço"
          htmlFor="plan-price"
          error={fieldErrors.price}
          hint="Cobrado a cada ciclo."
        >
          <input
            id="plan-price"
            name="price"
            type="text"
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            className={INPUT_CLASS}
            placeholder="79,00"
          />
        </Field>

        <Field label="Ciclo" htmlFor="plan-cycle" error={fieldErrors.cycle}>
          <select
            id="plan-cycle"
            name="cycle"
            value={cycle}
            onChange={(event) => setCycle(event.target.value as MembershipCycle)}
            className={INPUT_CLASS}
          >
            {MEMBERSHIP_CYCLES.map((value) => (
              <option key={value} value={value}>
                {MEMBERSHIP_CYCLE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4">
        <legend className="px-1 text-sm font-medium">Benefícios por ciclo</legend>
        <p className="text-xs text-[var(--color-secondary)]">
          Quantos atendimentos de cada serviço o assinante ganha a cada ciclo.
        </p>

        {benefits.length === 0 ? (
          <p className="text-sm text-[var(--color-secondary)]">
            Nenhum benefício ainda. Um plano sem benefícios não entrega nada ao assinante.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {benefits.map((row) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-[12rem] flex-1 flex-col gap-1.5">
                  <label htmlFor={`benefit-service-${row.key}`} className="text-xs font-medium">
                    Serviço
                  </label>
                  <select
                    id={`benefit-service-${row.key}`}
                    value={row.serviceId}
                    onChange={(event) =>
                      updateBenefit(row.key, { serviceId: event.target.value })
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="">Selecione…</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                        {service.active ? '' : ' (inativo)'}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex w-28 flex-col gap-1.5">
                  <label htmlFor={`benefit-quantity-${row.key}`} className="text-xs font-medium">
                    Por ciclo
                  </label>
                  <input
                    id={`benefit-quantity-${row.key}`}
                    type="number"
                    inputMode="numeric"
                    min={BENEFIT_QUANTITY_MIN}
                    max={BENEFIT_QUANTITY_MAX}
                    value={row.quantity}
                    onChange={(event) =>
                      updateBenefit(row.key, { quantity: event.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => removeBenefit(row.key)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-xs font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}

        {fieldErrors.benefits ? (
          <p role="alert" className="text-xs text-[var(--color-danger)]">
            {fieldErrors.benefits}
          </p>
        ) : null}

        <div>
          <button
            type="button"
            onClick={addBenefit}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--color-muted)]"
          >
            Adicionar benefício
          </button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => setActive(event.target.checked)}
        />
        Plano ativo no portal
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
          {pending ? 'Salvando…' : mode === 'create' ? 'Criar plano' : 'Salvar alterações'}
        </button>
        <button
          type="button"
          onClick={() => router.push(PLANS_PATH as Route)}
          className="rounded-lg border border-[var(--color-border)] px-4 py-3 text-sm font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
