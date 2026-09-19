import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/rbac';
import { listServices } from '@/lib/catalog/services';
import { getStaffMember, listTimeOff } from '@/lib/staffing/members';
import { ScheduleEditor } from '../_components/ScheduleEditor';
import { StaffServicesForm } from '../_components/StaffServicesForm';
import { TimeOffManager } from '../_components/TimeOffManager';

export default async function EquipeProfissionalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireRole('OWNER');

  const data = await context.forTenant(async (tx) => {
    const member = await getStaffMember(tx, context.tenant.id, id);
    if (!member) return null;
    const timeOff = await listTimeOff(tx, context.tenant.id, id);
    const services = await listServices(tx, context.tenant.id);
    return { member, timeOff, services };
  });

  if (!data) notFound();
  const { member, timeOff, services } = data;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-lg font-semibold">{member.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          {member.phone}
          {member.active ? '' : ' · inativo'}
        </p>
      </header>

      <ScheduleEditor
        staffId={member.id}
        initial={member.workingHours}
        timezone={context.tenant.timezone}
      />
      <TimeOffManager
        staffId={member.id}
        initial={timeOff}
        timezone={context.tenant.timezone}
      />
      <StaffServicesForm
        staffId={member.id}
        services={services.map((service) => ({
          id: service.id,
          name: service.name,
          active: service.active,
        }))}
        initialServiceIds={member.serviceIds}
      />
    </section>
  );
}
