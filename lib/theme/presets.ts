/**
 * Presets de tema da spec §5.1 (tarefa F2.3).
 *
 * PRESET É PONTO DE PARTIDA, NÃO VÍNCULO. Aplicar um preset persiste as TRÊS
 * cores nas colunas do `Tenant`; `themePreset` fica só como rótulo. O
 * `lib/theme/resolve.ts` da F3.0 ignora o campo de propósito — quem manda no
 * tema do portal são as colunas de cor. Se o preset fosse vínculo vivo, mexer
 * na paleta "Classic Barber" mudaria a identidade de todos os salões que a
 * usam, e o dono não conseguiria ajustar uma cor isolada sem sair do preset.
 *
 * Cada preset foi escolhido para passar na validação de contraste da tela de
 * marca (`assessContrast`): primária seca, secundária legível sobre o fundo e
 * fundo claro/escuro coerente com o que o nome promete. Um preset oficial que
 * dispara aviso de contraste logo ao ser aplicado seria ruído para o dono.
 *
 * Sem cor literal em componente: as cores DAQUI são dado de configuração, não
 * estilo cravado — quem as injeta no HTML é o resolvedor da F3.0.
 */

export type ThemePresetId =
  | 'classic-barber'
  | 'beauty-spa'
  | 'pet-friendly'
  | 'auto-detail';

export interface ThemePresetColors {
  /** Botões de ação e destaque de horários selecionados. */
  primary: string;
  /** Badges, detalhes e elementos de apoio. */
  secondary: string;
  /** Fundo do portal (define modo claro/escuro). */
  background: string;
}

export interface ThemePreset {
  id: ThemePresetId;
  name: string;
  description: string;
  colors: ThemePresetColors;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'classic-barber',
    name: 'Classic Barber',
    description: 'Tons escuros, preto fosco e dourado/âmbar.',
    colors: {
      primary: '#d4a24c',
      secondary: '#d8cfc0',
      background: '#0c0a09',
    },
  },
  {
    id: 'beauty-spa',
    name: 'Beauty & Spa',
    description: 'Tons pastel, rosé, bege e branco minimalista.',
    colors: {
      primary: '#a85a67',
      secondary: '#6b4f47',
      background: '#fff7f2',
    },
  },
  {
    id: 'pet-friendly',
    name: 'Pet Friendly',
    description: 'Azul celeste, verde menta e amarelo vibrante.',
    colors: {
      primary: '#0369a1',
      secondary: '#0f766e',
      background: '#fefce8',
    },
  },
  {
    id: 'auto-detail',
    name: 'Auto Detail',
    description: 'Grafite escuro, azul metálico e vermelho esportivo.',
    colors: {
      primary: '#3b82f6',
      secondary: '#ef4444',
      background: '#18181b',
    },
  },
] as const;

export function getThemePreset(id: string | null | undefined): ThemePreset | null {
  if (!id) return null;
  return THEME_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Qual preset (se algum) produz EXATAMENTE estas três cores.
 *
 * É por igualdade estrita, e não por "preset escolhido", que o rótulo do banco
 * permanece verdadeiro: assim que o dono ajusta uma cor, o tema deixa de ser o
 * preset e o campo vira `null` (personalizado). O contrário — guardar o preset
 * de origem depois de mexer na paleta — faria o rótulo mentir.
 */
export function matchThemePreset(
  colors: Pick<ThemePresetColors, 'primary' | 'secondary' | 'background'> | null | undefined,
): ThemePreset | null {
  if (!colors) return null;
  const normalize = (value: string | null | undefined) => value?.trim().toLowerCase() ?? null;
  const primary = normalize(colors.primary);
  const secondary = normalize(colors.secondary);
  const background = normalize(colors.background);
  if (!primary || !secondary || !background) return null;

  return (
    THEME_PRESETS.find(
      (preset) =>
        preset.colors.primary.toLowerCase() === primary &&
        preset.colors.secondary.toLowerCase() === secondary &&
        preset.colors.background.toLowerCase() === background,
    ) ?? null
  );
}
