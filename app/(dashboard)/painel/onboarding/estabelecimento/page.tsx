import { requireRole } from '@/lib/auth/rbac';
import { Stepper } from '../_components/Stepper';
import { EstablishmentStep } from '../_components/EstablishmentStep';
import { loadOnboarding } from '../service';

export default async function EstabelecimentoPage() {
  const context = await requireRole('OWNER');
  const onboarding = await context.forTenant((tx) => loadOnboarding(tx, context.tenant.id));

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Dados do estabelecimento</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Comece pelo que o cliente vê e por onde você recebe.
        </p>
      </header>

      <Stepper completedSteps={onboarding.completedSteps} currentStep="ESTABLISHMENT" />

      <EstablishmentStep
        initialName={onboarding.name}
        initialDocument={onboarding.document}
        initialPixKey={onboarding.pixKey ?? ''}
        payoutAwaitingActivation={onboarding.payoutStatus === 'AWAITING_ACTIVATION'}
      />
    </section>
  );
}
