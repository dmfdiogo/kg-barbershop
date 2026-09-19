import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { requireRole } from '@/lib/auth/rbac';
import { loadOnboarding } from './service';
import { stepRoute } from './steps';

/**
 * Entrada do onboarding (tarefa F2.5).
 *
 * Não tem tela própria: resolve o primeiro passo ainda não concluído e manda
 * para ele. É isto que faz "abandonar no meio e voltar" retomar exatamente onde
 * parou — o estado é lido do banco a cada visita, nunca de um cookie ou de um
 * formulário em memória.
 */
export default async function OnboardingIndexPage() {
  const context = await requireRole('OWNER');
  const onboarding = await context.forTenant((tx) => loadOnboarding(tx, context.tenant.id));

  if (onboarding.currentStep === null) {
    redirect('/painel/onboarding/pronto');
  }
  redirect(stepRoute(onboarding.currentStep) as Route);
}
