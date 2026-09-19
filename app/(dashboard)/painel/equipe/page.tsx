import { requireRole } from '@/lib/auth/rbac';
import { listStaffMembers } from '@/lib/staffing/members';
import { InviteForm } from './_components/InviteForm';
import { TeamList } from './_components/TeamList';

export default async function EquipePage() {
  const context = await requireRole('OWNER');
  const members = await context.forTenant((tx) => listStaffMembers(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Equipe</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Convide profissionais por telefone e defina jornada, bloqueios e serviços.
        </p>
      </header>

      <InviteForm />
      <TeamList members={members} />
    </section>
  );
}
