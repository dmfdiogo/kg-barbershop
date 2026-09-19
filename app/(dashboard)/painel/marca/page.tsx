import { notFound } from 'next/navigation';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import { resolveTheme } from '@/lib/theme/resolve';
import { THEME_PRESETS, matchThemePreset } from '@/lib/theme/presets';
import { BrandingForm } from './BrandingForm';

/**
 * Tela de marca / white-label (tarefa F2.3).
 *
 * O painel (layout do segmento) já exige STAFF ou OWNER. Aqui a exigência é
 * OWNER: a identidade visual é do dono, e o staff que digitar a URL direto
 * recebe o 404 do segmento em vez de um 500 de `AuthError`. Esconder o item do
 * menu não é a proteção — o portão é esta checagem.
 *
 * As cores iniciais saem do RESOLVEDOR, não das colunas cruas: um tenant sem
 * tema configurado (o `petspaluna` do seed) abre o editor com os padrões
 * visíveis, e não com campos vazios.
 */
async function requireOwnerOrNotFound() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) notFound();
    throw error;
  }
}

export default async function MarcaPage() {
  const context = await requireOwnerOrNotFound();
  const theme = resolveTheme(context.tenant);
  const initial = {
    primary: theme.primary,
    secondary: theme.secondary,
    background: theme.background,
  };

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Marca</h1>
      <p className="mt-1 text-sm text-[var(--color-secondary)]">
        Personalize o logo e as cores do seu portal. As cores entram no HTML da página do cliente
        já no primeiro carregamento, sem piscar o tema padrão.
      </p>

      <BrandingForm
        tenantName={context.tenant.name}
        initial={initial}
        initialPresetId={matchThemePreset(initial)?.id ?? null}
        hasLogo={Boolean(context.tenant.logoUrl)}
        logoUrl={context.tenant.logoUrl ?? null}
        presets={THEME_PRESETS}
      />
    </section>
  );
}
