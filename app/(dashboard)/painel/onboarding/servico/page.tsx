import { requireRole } from '@/lib/auth/rbac';
import { listTenantStaff } from '@/lib/catalog/services';
import { listStaffMembers } from '@/lib/staffing/members';
import { Stepper } from '../_components/Stepper';
import { ServiceStep } from '../_components/ServiceStep';
import { loadOnboarding } from '../service';

export default async function ServicoPage() {
  const context = await requireRole('OWNER');
  const { onboarding, staff, ownerStaffId } = await context.forTenant(async (tx) => {
    const view = await loadOnboarding(tx, context.tenant.id);
    const options = await listTenantStaff(tx, context.tenant.id);
    const members = await listStaffMembers(tx, context.tenant.id);
    return {
      onboarding: view,
      staff: options,
      ownerStaffId: members.find((member) => member.role === 'OWNER')?.id ?? null,
    };
  });

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Primeiro serviço</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          O que o cliente pode agendar. Você pode criar mais depois, em Serviços.
        </p>
      </header>

      <Stepper completedSteps={onboarding.completedSteps} currentStep="SERVICE" />

      <ServiceStep staff={staff} ownerStaffId={ownerStaffId} />
    </section>
  );
}
