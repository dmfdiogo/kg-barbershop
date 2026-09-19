import { requireRole } from '@/lib/auth/rbac';
import { listStaffMembers } from '@/lib/staffing/members';
import { Stepper } from '../_components/Stepper';
import { HoursStep, PrepareAgenda } from '../_components/HoursStep';
import { loadOnboarding, defaultWeeklyHours } from '../service';

export default async function HorarioPage() {
  const context = await requireRole('OWNER');
  const { onboarding, owner } = await context.forTenant(async (tx) => {
    const view = await loadOnboarding(tx, context.tenant.id);
    const members = await listStaffMembers(tx, context.tenant.id);
    return {
      onboarding: view,
      owner: members.find((member) => member.role === 'OWNER') ?? null,
    };
  });

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Horário de expediente</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Quando você atende. O cliente só vê horários dentro dessa janela.
        </p>
      </header>

      <Stepper completedSteps={onboarding.completedSteps} currentStep="HOURS" />

      {owner ? (
        <HoursStep
          staffId={owner.id}
          initial={owner.workingHours.length > 0 ? owner.workingHours : defaultWeeklyHours()}
          timezone={context.tenant.timezone}
        />
      ) : (
        <PrepareAgenda />
      )}
    </section>
  );
}
