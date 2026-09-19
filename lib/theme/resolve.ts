/**
 * Resolução do tema do portal (F3.0) — o contrato que a F2.3 consome.
 *
 * O portal é renderizado no SERVIDOR com as CSS variables do tenant já
 * injetadas no HTML (`themeCssText`), e não por JavaScript no cliente: é isso
 * que evita o flash de tema errado quando o celular abre o link do WhatsApp.
 *
 * CONTRATO COM A F2.3: aqui só entram as TRÊS cores de marca que o dono
 * customiza (spec §5.1) — primária, secundária e fundo. `themePreset` NÃO é
 * lido de propósito: os presets vivem em `lib/theme/presets.ts` (F2.3), que os
 * resolve para cores na tela de edição e as persiste nas colunas do Tenant.
 * Enquanto o dono não salvar cores, o portal cai nos padrões — que é o estado
 * do tenant `petspaluna` do seed.
 *
 * Duas decisões que não são óbvias:
 *
 * 1. **Nunca confie na cor vinda do banco.** O valor é interpolado num `<style>`
 *    do SSR; sem validação, `colorPrimary = "red}</style><script>…"` seria XSS
 *    armazenado. Só hex da forma `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa` passa;
 *    qualquer outra coisa silenciosamente vira padrão.
 * 2. **As cores funcionais mudam de variante com o fundo, mas continuam
 *    fixas.** `--color-success`/`--color-warning`/`--color-danger` não são do
 *    tenant (contexto-comum.md §2): o dono não escolhe o vermelho de
 *    cancelamento. O que a resolução decide é a variante clara ou escura da
 *    MESMA paleta fixa, para que o status continue legível sobre um fundo
 *    escuro — antes isso vinha de `prefers-color-scheme`, que não conhece a
 *    escolha de fundo do tenant.
 *
 * As cores derivadas (foreground, superfícies, bordas, texto sobre a primária)
 * são calculadas a partir do fundo e da primária para manter tudo legível
 * quando o dono configura só uma parte do tema.
 */

/** Campos do Tenant que o tema lê. Estruturalmente compatível com `TenantRoutingInfo`. */
export interface TenantThemeInput {
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  colorBackground?: string | null;
}

export type ThemeColorScheme = 'light' | 'dark';

export interface ResolvedTheme {
  scheme: ThemeColorScheme;
  primary: string;
  /** Texto/ícone sobre a cor primária (calculado por contraste). */
  primaryForeground: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  // Funcionais: fixas, apenas na variante compatível com o fundo.
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** true quando nenhuma cor de marca veio do tenant: tema 100% padrão. */
  isDefault: boolean;
}

/**
 * Padrões de marca — os mesmos do `:root` de `app/globals.css`, o que mantém
 * portal e demais telas coerentes. Um teste de unidade guarda essa igualdade.
 */
const LIGHT = {
  primary: '#171717',
  secondary: '#525252',
  background: '#ffffff',
  foreground: '#171717',
  muted: '#f5f5f5',
  border: '#e5e5e5',
} as const;

/**
 * Variante escura da MESMA paleta fixa (antes só existia no
 * `prefers-color-scheme` de `app/globals.css`). O fundo escuro `#0a0a0a` fica
 * aqui como referência; o fundo do tenant nunca é "padrão escuro" — ou ele
 * escolheu uma cor, ou vale o branco.
 */
const DARK = {
  primary: '#fafafa',
  secondary: '#a3a3a3',
  background: '#0a0a0a',
  foreground: '#fafafa',
  muted: '#171717',
  border: '#262626',
} as const;

const FUNCTIONAL_LIGHT = {
  success: '#15803d',
  successSoft: '#dcfce7',
  warning: '#a16207',
  warningSoft: '#fef9c3',
  danger: '#b91c1c',
  dangerSoft: '#fee2e2',
} as const;

const FUNCTIONAL_DARK = {
  success: '#4ade80',
  successSoft: '#14321f',
  warning: '#facc15',
  warningSoft: '#332a10',
  danger: '#f87171',
  dangerSoft: '#3a1717',
} as const;

/**
 * Luminância relativa acima da qual o fundo é claro (WCAG: 0,179 é o ponto em
 * que o branco atinge 4,5:1 sobre ele). O cinza médio cai para o lado escuro —
 * decisão conservadora, porque texto claro sobre cinza médio erra menos que
 * texto escuro.
 */
const DARK_BACKGROUND_MAX_LUMINANCE = 0.179;

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Aceita só hex; qualquer outra string vira padrão (nunca chega ao `<style>`). */
function sanitizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function hexBody(hexColor: string): string {
  const body = hexColor.slice(1).toLowerCase();
  // 3 e 4 dígitos são a forma curta: cada dígito vale por dois.
  if (body.length === 3 || body.length === 4) {
    return body
      .split('')
      .map((digit) => digit + digit)
      .join('');
  }
  return body;
}

function relativeLuminance(hexColor: string): number {
  const body = hexBody(hexColor);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(body.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** Texto da primária: dos dois extremos fixos, o que tiver maior contraste. */
function bestForeground(background: string): string {
  return contrastRatio(background, LIGHT.foreground) >=
    contrastRatio(background, DARK.foreground)
    ? LIGHT.foreground
    : DARK.foreground;
}

/**
 * Resolve o tema efetivo do portal. Entrada ausente (`null`, tenant não
 * encontrado) é válida e devolve os padrões: quem chama nunca precisa de um
 * `if` para renderizar sem quebrar.
 */
export function resolveTheme(input?: TenantThemeInput | null): ResolvedTheme {
  const providedPrimary = sanitizeHex(input?.colorPrimary);
  const providedSecondary = sanitizeHex(input?.colorSecondary);
  const providedBackground = sanitizeHex(input?.colorBackground);

  const background = providedBackground ?? LIGHT.background;
  const scheme: ThemeColorScheme =
    relativeLuminance(background) < DARK_BACKGROUND_MAX_LUMINANCE ? 'dark' : 'light';
  const neutrals = scheme === 'dark' ? DARK : LIGHT;
  const functional = scheme === 'dark' ? FUNCTIONAL_DARK : FUNCTIONAL_LIGHT;

  const primary = providedPrimary ?? neutrals.primary;
  const secondary = providedSecondary ?? neutrals.secondary;

  return {
    scheme,
    primary,
    primaryForeground: bestForeground(primary),
    secondary,
    background,
    foreground: neutrals.foreground,
    muted: neutrals.muted,
    border: neutrals.border,
    ...functional,
    isDefault: !providedPrimary && !providedSecondary && !providedBackground,
  };
}

/** Tema padrão da plataforma — tenant sem nenhuma cor configurada. */
export const DEFAULT_THEME: ResolvedTheme = resolveTheme(null);

/** Nome de cada variável injetada, na ordem em que aparece no HTML. */
export function themeCssVariables(theme: ResolvedTheme): Record<string, string> {
  return {
    '--color-primary': theme.primary,
    '--color-primary-foreground': theme.primaryForeground,
    '--color-secondary': theme.secondary,
    '--color-background': theme.background,
    '--color-foreground': theme.foreground,
    '--color-muted': theme.muted,
    '--color-border': theme.border,
    '--color-success': theme.success,
    '--color-success-soft': theme.successSoft,
    '--color-warning': theme.warning,
    '--color-warning-soft': theme.warningSoft,
    '--color-danger': theme.danger,
    '--color-danger-soft': theme.dangerSoft,
  };
}

/**
 * CSS pronto para o `<style>` do SSR. `color-scheme` acompanha o fundo para que
 * controles nativos (select, scrollbar) não destoem do tema escolhido.
 */
export function themeCssText(theme: ResolvedTheme): string {
  const declarations = Object.entries(themeCssVariables(theme))
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
  return `:root{color-scheme:${theme.scheme};${declarations}}`;
}
