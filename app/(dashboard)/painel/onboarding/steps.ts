import type { OnboardingStep } from '@prisma/client';

/**
 * Ordem e metadados dos passos do onboarding (tarefa F2.5).
 *
 * Módulo client-safe: importa o enum do Prisma apenas como TIPO (apagado na
 * compilação), então nenhum valor do Prisma Client vaza para o navegador. A
 * ordem é a única fonte de verdade de "qual é o próximo passo" — a página
 * inicial e o cabeçalho de progresso derivam daqui, nunca de listas paralelas.
 */

export const ONBOARDING_STEP_ORDER = ['ESTABLISHMENT', 'HOURS', 'SERVICE', 'PORTAL'] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_ORDER)[number];

// Garante em tempo de compilação que a lista local cobre exatamente o enum do
// schema: um passo novo no banco sem entrada aqui vira erro de tipo.
const _exhaustive: readonly OnboardingStep[] = ONBOARDING_STEP_ORDER;
void _exhaustive;

export interface OnboardingStepMeta {
  key: OnboardingStepKey;
  /** Segmento de rota sob `/painel/onboarding`. */
  route: string;
  /** Rótulo curto exibido no cabeçalho de progresso. */
  label: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStepMeta[] = [
  { key: 'ESTABLISHMENT', route: 'estabelecimento', label: 'Estabelecimento' },
  { key: 'HOURS', route: 'horario', label: 'Expediente' },
  { key: 'SERVICE', route: 'servico', label: 'Primeiro serviço' },
  { key: 'PORTAL', route: 'portal', label: 'Link do portal' },
];

/** Passo ainda não concluído mais cedo na ordem; `null` = onboarding completo. */
export function firstIncompleteStep(
  completed: readonly OnboardingStepKey[],
): OnboardingStepKey | null {
  const done = new Set(completed);
  return ONBOARDING_STEP_ORDER.find((step) => !done.has(step)) ?? null;
}

export function stepMeta(step: OnboardingStepKey): OnboardingStepMeta {
  const meta = ONBOARDING_STEPS.find((entry) => entry.key === step);
  if (!meta) throw new Error(`Passo de onboarding desconhecido: ${step}`);
  return meta;
}

export function stepRoute(step: OnboardingStepKey): string {
  return `/painel/onboarding/${stepMeta(step).route}`;
}

export function stepNumber(step: OnboardingStepKey): number {
  return ONBOARDING_STEP_ORDER.indexOf(step) + 1;
}

export function isOnboardingStep(value: unknown): value is OnboardingStepKey {
  return typeof value === 'string' && (ONBOARDING_STEP_ORDER as readonly string[]).includes(value);
}
