'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createWalkInAction } from '../actions';
import type {
  AgendaFieldErrors,
  AgendaServiceOption,
  AgendaStaffOption,
} from '../_lib/types';

/**
 * Walk-in criado pelo painel (tarefa F3.5): cliente de pé no balcão. O Staff só
 * cria para si (o servidor força o profissional); o Owner escolhe qualquer um.
 * Pode furar a antecedência mínima, mas o anti-overlap continua valendo — o
 * horário ocupado volta como mensagem, não como erro de servidor.
 */

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm outline-none focus:border-[var(--color-primary)]';

export interface WalkInFormProps {
  staffOptions: AgendaStaffOption[];
  services: AgendaServiceOption[];
  defaultStaffId: string;
  /** OWNER escolhe o profissional; STAFF cria só para si. */
  canChooseStaff: boolean;
}

export function WalkInForm({
  staffOptions,
  services,
  defaultStaffId,
  canChooseStaff,
}: WalkInFormProps) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(defaultStaffId);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AgendaFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    startTransition(async () => {
      const result = await createWalkInAction({
        staffId: canChooseStaff ? staffId : defaultStaffId,
        serviceId,
        customerName,
        customerPhone,
        startsAtLocal,
      });
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setError(result.message);
        return;
      }
      setCustomerName('');
      setCustomerPhone('');
      setStartsAtLocal('');
      setSuccess('Walk-in agendado.');
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4">
      <header>
        <h2 className="text-sm font-semibold">Novo walk-in</h2>
        <p className="mt-1 text-xs text-[var(--color-secondary)]">
          Para quem chegou sem agendar. Ignora a antecedência mínima; não ignora
          a ocupação do horário.
        </p>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {canChooseStaff ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="walkin-staff" className="text-xs font-medium">
              Profissional
            </label>
            <select
              id="walkin-staff"
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Selecione…</option>
              {staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
            {fieldErrors.staffId ? (
              <p className="text-xs text-[var(--color-danger)]">{fieldErrors.staffId}</p>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="walkin-service" className="text-xs font-medium">
            Serviço
          </label>
          <select
            id="walkin-service"
            value={serviceId}
            onChange={(event) => setServiceId(event.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Selecione…</option>
            {services.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name} · {service.durationMin} min
              </option>
            ))}
          </select>
          {fieldErrors.serviceId ? (
            <p className="text-xs text-[var(--color-danger)]">{fieldErrors.serviceId}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="walkin-name" className="text-xs font-medium">
            Nome do cliente
          </label>
          <input
            id="walkin-name"
            type="text"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            className={INPUT_CLASS}
            placeholder="Ex.: Ana Souza"
          />
          {fieldErrors.customerName ? (
            <p className="text-xs text-[var(--color-danger)]">{fieldErrors.customerName}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="walkin-phone" className="text-xs font-medium">
            WhatsApp
          </label>
          <input
            id="walkin-phone"
            type="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
            className={INPUT_CLASS}
            placeholder="+5548999999999"
          />
          {fieldErrors.customerPhone ? (
            <p className="text-xs text-[var(--color-danger)]">{fieldErrors.customerPhone}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="walkin-start" className="text-xs font-medium">
            Início
          </label>
          <input
            id="walkin-start"
            type="datetime-local"
            value={startsAtLocal}
            onChange={(event) => setStartsAtLocal(event.target.value)}
            className={INPUT_CLASS}
          />
          {fieldErrors.startsAt ? (
            <p className="text-xs text-[var(--color-danger)]">{fieldErrors.startsAt}</p>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="mt-3 text-sm text-[var(--color-success)]">
          {success}
        </p>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Agendando…' : 'Agendar walk-in'}
        </button>
      </div>
    </section>
  );
}
