'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { PlanChangeAssessment } from '@/lib/billing/limits';
import { BILLING_PLANS } from '@/lib/billing/plans';
import { formatCents } from '@/lib/money';
import { changePlanAction } from '../actions';

/**
 * Confirmação da troca de plano (tarefa F8.0-B).
 *
 * O DOWNGRADE NÃO DESATIVA NINGUÉM NO ESCURO. Quando o plano de destino não
 * comporta todos os profissionais ativos, a avaliação (`assessPlanChange`, feita
 * no servidor) traz o excesso e a lista de agendas; o dono escolhe exatamente
 * quem desativar. Sem a escolha completa, `changePlan` recusa e nada é gravado
 * (`lib/billing/limits.ts`). Servidor é a autoridade — esta tela só coleta a
 * decisão e mostra o erro que voltar.
 */
interface PlanChangePanelProps {
  assessment: PlanChangeAssessment;
}

function limitLabel(limit: number | null): string {
  if (limit === null) return 'agendas ilimitadas';
  if (limit === 1) return '1 agenda ativa';
  return `até ${limit} agendas ativas`;
}

export function PlanChangePanel({ assessment }: PlanChangePanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const nextPlan = BILLING_PLANS[assessment.nextPlan];
  const currentPlan = assessment.currentPlan ? BILLING_PLANS[assessment.currentPlan] : null;
  const upgrade = assessment.direction === 'UPGRADE';
  const enough = !assessment.requiresDecision || selected.length === assessment.excess;

  function toggle(staffId: string) {
    setError(null);
    setSelected((current) => {
      if (current.includes(staffId)) {
        return current.filter((id) => id !== staffId);
      }
      if (current.length >= assessment.excess) return current;
      return [...current, staffId];
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await changePlanAction(assessment.nextPlan, selected);
      if (result.ok) {
        router.push('/painel/assinatura' as Route);
        router.refresh();
        return;
      }
      setError(result.message);
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-4">
      <div>
        <h2 className="text-sm font-semibold">
          {upgrade ? 'Fazer upgrade para' : 'Fazer downgrade para'} {nextPlan.name}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          {formatCents(nextPlan.priceCents)}/mês
          {currentPlan ? ` · hoje no ${currentPlan.name}` : ''}
        </p>
      </div>

      {upgrade ? (
        <p className="text-sm text-[var(--color-secondary)]">
          A mudança vale na hora e a diferença é calculada proporcionalmente pelo
          provedor na próxima fatura.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-secondary)]">
            O plano {nextPlan.name} permite {limitLabel(assessment.nextLimit)} e o salão tem{' '}
            {assessment.activeAgendas} ativa(s).
            {assessment.requiresDecision
              ? ` Escolha ${assessment.excess} profissional(is) para desativar antes de aplicar.`
              : ' O salão cabe no novo plano sem desativar ninguém.'}
          </p>

          {assessment.requiresDecision ? (
            <>
              <p className="text-xs text-[var(--color-warning)]">
                A agenda do profissional fica inativa e ele deixa de receber novos
                agendamentos. Os agendamentos já marcados NÃO são apagados.
              </p>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-xs font-medium">
                  Quem desativar ({selected.length}/{assessment.excess})
                </legend>
                {assessment.agendas.map((agenda) => {
                  const checked = selected.includes(agenda.id);
                  const disabled = !checked && selected.length >= assessment.excess;
                  return (
                    <label
                      key={agenda.id}
                      className={
                        disabled
                          ? 'flex items-center gap-2 text-sm text-[var(--color-secondary)]'
                          : 'flex items-center gap-2 text-sm'
                      }
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(agenda.id)}
                      />
                      {agenda.name}
                    </label>
                  );
                })}
              </fieldset>
            </>
          ) : null}
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || !enough}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Aplicando…' : `Confirmar ${upgrade ? 'upgrade' : 'downgrade'}`}
        </button>
        <Link
          href={'/painel/assinatura' as Route}
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-center text-sm font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
        >
          Cancelar
        </Link>
      </div>
    </section>
  );
}
