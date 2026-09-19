import { requireRole } from '@/lib/auth/rbac';
import { getAppDomain } from '@/lib/tenant/slugs';
import { loadPortalSettings } from '@/app/(dashboard)/painel/configuracoes/service';
import { Stepper } from '../_components/Stepper';
import { PortalStep } from '../_components/PortalStep';
import { loadOnboarding } from '../service';

export default async function PortalPage() {
  const context = await requireRole('OWNER');
  const { onboarding, settings } = await context.forTenant(async (tx) => ({
    onboarding: await loadOnboarding(tx, context.tenant.id),
    settings: await loadPortalSettings(tx, context.tenant.id),
  }));

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Link do portal</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          É o endereço que você compartilha com seus clientes.
        </p>
      </header>

      <Stepper completedSteps={onboarding.completedSteps} currentStep="PORTAL" />

      <PortalStep initialSlug={settings.slug} appDomain={getAppDomain()} />
    </section>
  );
}
