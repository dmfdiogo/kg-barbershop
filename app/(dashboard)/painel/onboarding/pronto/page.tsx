import { redirect } from 'next/navigation';
import type { Route } from 'next';
import { requireRole } from '@/lib/auth/rbac';
import { getAppDomain } from '@/lib/tenant/slugs';
import { loadPortalSettings } from '@/app/(dashboard)/painel/configuracoes/service';
import { PortalLinkReady } from '../_components/PortalLinkReady';
import { loadOnboarding } from '../service';
import { stepRoute } from '../steps';

/**
 * Tela final do onboarding (tarefa F2.5): o link pronto para colar no WhatsApp.
 *
 * Se algum passo ainda estiver pendente, devolve o dono para ele em vez de
 * mostrar um "pronto" mentiroso — o critério é o link funcionando, não a tela.
 */
export default async function ProntoPage() {
  const context = await requireRole('OWNER');
  const onboarding = await context.forTenant((tx) => loadOnboarding(tx, context.tenant.id));

  if (onboarding.currentStep !== null) {
    redirect(stepRoute(onboarding.currentStep) as Route);
  }

  const { settings } = await context.forTenant(async (tx) => ({
    settings: await loadPortalSettings(tx, context.tenant.id),
  }));
  const url = `https://${getAppDomain()}/${settings.slug}`;

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Tudo pronto</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Seu portal está no ar. Cole o link no WhatsApp e comece a receber agendamentos.
        </p>
      </header>

      <PortalLinkReady url={url} tenantName={onboarding.name} />

      <div className="rounded-xl border border-[var(--color-border)] p-5 text-sm">
        <p className="font-medium">Recebimento</p>
        <p className="mt-1 text-[var(--color-secondary)]">
          {onboarding.payoutStatus === 'AWAITING_ACTIVATION'
            ? 'Aguardando ativação. Enquanto isso, você pode cobrar no local normalmente.'
            : 'Conta de recebimento ativa.'}
        </p>
        {onboarding.pixKey ? (
          <p className="mt-1 text-xs text-[var(--color-secondary)]">Chave Pix: {onboarding.pixKey}</p>
        ) : null}
      </div>
    </section>
  );
}
