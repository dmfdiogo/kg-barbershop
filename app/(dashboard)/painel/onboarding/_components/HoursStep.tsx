'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ScheduleEditor } from '@/app/(dashboard)/painel/equipe/_components/ScheduleEditor';
import { completeOnboardingStepAction, ensureOwnerProfileAction } from '../actions';
import type { WorkingHoursView } from '@/lib/staffing/types';

/**
 * Passo 2 — horário de expediente (tarefa F2.5).
 *
 * NÃO reescreve a jornada: reusa o `ScheduleEditor` da F2.2, que já fala com
 * `saveWeeklyScheduleAction` e já trata os conflitos com agendamentos. Ao
 * concluir, marca o passo e segue para o primeiro serviço.
 */
export function HoursStep({
  staffId,
  initial,
  timezone,
}: {
  staffId: string;
  initial: WorkingHoursView[];
  timezone: string;
}) {
  const router = useRouter();

  async function handleSaved() {
    await completeOnboardingStepAction('HOURS');
    router.push('/painel/onboarding/servico' as Route);
  }

  return <ScheduleEditor staffId={staffId} initial={initial} timezone={timezone} onSaved={handleSaved} />;
}

/**
 * Fallback raro: o dono chegou ao passo de expediente sem perfil de
 * profissional (retomou a URL direto). Um botão garante o perfil — operação
 * idempotente — e a página recarrega com o editor.
 */
export function PrepareAgenda() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-secondary)]">
        Vamos preparar a sua agenda de atendimentos.
      </p>
      <div>
        <button
          type="button"
          onClick={async () => {
            await ensureOwnerProfileAction();
            router.refresh();
          }}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
        >
          Preparar agenda
        </button>
      </div>
    </div>
  );
}
