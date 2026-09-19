import type { ReactNode } from 'react';
import type { TenantRoutingInfo } from '@/lib/tenant/context';
import { themeCssText, type ResolvedTheme } from '@/lib/theme/resolve';

/**
 * Casca do portal público (F3.0): o HTML que o cliente final vê ao abrir o link
 * do WhatsApp no celular.
 *
 * O tema entra AQUI, no SSR — um `<style>` com as variáveis resolvidas do
 * tenant acompanha o primeiro byte da página, então não existe janela em que
 * ela apareça com a cor errada esperando JavaScript.
 *
 * Mobile-first: layout de uma coluna, `min-h-dvh` e áreas de toque confortáveis
 * (>= 40px). A largura confortável em telas grandes vem do `max-w-3xl`, sem
 * media query própria.
 *
 * `basePath` vem de `portalBasePath()`: vazio no subdomínio e no domínio
 * próprio, `/<slug>` na forma por caminho.
 */
export function PortalShell({
  tenant,
  theme,
  basePath,
  children,
}: {
  tenant: Pick<TenantRoutingInfo, 'name' | 'logoUrl'>;
  theme: ResolvedTheme;
  basePath: string;
  children: ReactNode;
}) {
  const initial = tenant.name.trim().charAt(0).toUpperCase() || '?';
  const homeHref = basePath || '/';

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-background)] text-[var(--color-foreground)]">
      <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: themeCssText(theme) }} />

      <header className="border-b border-[var(--color-border)]">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-4 sm:px-6">
          <a href={homeHref} className="flex min-w-0 items-center gap-3">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- o logo é uma URL externa arbitrária do tenant; liberar cada domínio no next.config não escala para white-label.
              <img
                src={tenant.logoUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-full border border-[var(--color-border)] object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-base font-semibold text-[var(--color-primary-foreground)]"
              >
                {initial}
              </span>
            )}
            <span className="min-w-0">
              <span className="block truncate text-base font-semibold">{tenant.name}</span>
              <span className="block text-xs text-[var(--color-secondary)]">
                Agendamento online
              </span>
            </span>
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-[var(--color-border)] px-4 py-6 text-center text-xs text-[var(--color-secondary)] sm:px-6">
        {tenant.name}
      </footer>
    </div>
  );
}
