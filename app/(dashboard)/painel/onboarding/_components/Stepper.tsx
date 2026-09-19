import { ONBOARDING_STEPS, type OnboardingStepKey } from '../steps';

/**
 * Cabeçalho de progresso do onboarding (tarefa F2.5).
 *
 * Componente de servidor: só monta a lista a partir de `steps.ts`. Cores sempre
 * por token — nada de cor literal, que quebraria o white-label de um cliente.
 */
export function Stepper({
  completedSteps,
  currentStep,
}: {
  completedSteps: readonly OnboardingStepKey[];
  currentStep: OnboardingStepKey | null;
}) {
  const done = new Set(completedSteps);

  return (
    <ol className="flex flex-wrap gap-2 text-xs" aria-label="Passos da configuração">
      {ONBOARDING_STEPS.map((step, index) => {
        const complete = done.has(step.key);
        const current = currentStep === step.key;
        return (
          <li
            key={step.key}
            aria-current={current ? 'step' : undefined}
            className={[
              'flex items-center gap-2 rounded-full border px-3 py-1.5',
              complete
                ? 'border-[var(--color-success)] text-[var(--color-success)]'
                : current
                  ? 'border-[var(--color-primary)] text-[var(--color-foreground)]'
                  : 'border-[var(--color-border)] text-[var(--color-secondary)]',
            ].join(' ')}
          >
            <span className="font-semibold">{index + 1}</span>
            <span>{step.label}</span>
            {complete ? <span aria-label="concluído">✓</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
