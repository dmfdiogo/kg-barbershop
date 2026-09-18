import type { TenantRoutingInfo } from '@/lib/tenant/context';

/**
 * Páginas próprias de tenant indisponível (F1.0).
 *
 * A spec é explícita: tenant inexistente, suspenso ou inativo NÃO pode cair num
 * 404 genérico. O componente é compartilhado por `app/[slug]/layout.tsx`
 * (formas subdomínio e /[slug]) e por `app/page.tsx` (raiz de domínio próprio),
 * para que os três caminhos mostrem a mesma cara.
 *
 * Status HTTP (decisão registrada):
 *   - inexistente e CANCELED → `notFound()` (404): um portal que não volta não
 *     pode ficar indexado no buscador para sempre;
 *   - suspenso (SUSPENDED) → página própria com 200: o tenant existe e volta.
 *
 * Sem cor literal: tokens de tema, como todo componente de produto.
 */
export function TenantNotFoundPage() {
  return (
    <StatusShell title="Estabelecimento não encontrado">
      <p>
        Confira o endereço digitado. O link pode ter sido alterado, ou o
        estabelecimento pode ter encerrado as atividades.
      </p>
    </StatusShell>
  );
}

export function TenantSuspendedPage({ tenant }: { tenant: TenantRoutingInfo | null }) {
  const name = tenant?.name;

  return (
    <StatusShell title="Estabelecimento temporariamente suspenso">
      <p className="rounded-md bg-[var(--color-warning-soft)] px-3 py-2 text-[var(--color-warning)]">
        {name ? `O portal de ${name} está` : 'Este portal está'} fora do ar
        temporariamente. Se você já tem um agendamento marcado, fale direto com
        o estabelecimento para confirmar.
      </p>
    </StatusShell>
  );
}

function StatusShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-3 px-4 py-8">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="text-sm text-[var(--color-secondary)]">{children}</div>
    </main>
  );
}
