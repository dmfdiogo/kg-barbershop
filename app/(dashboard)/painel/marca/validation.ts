/**
 * Validação das cores de marca e aviso de contraste (tarefa F2.3).
 *
 * Módulo puro e client-safe: o formulário usa as MESMAS funções que a server
 * action. Assim o aviso mostrado antes de salvar é idêntico ao que o servidor
 * recalculou — e a server action continua sendo a autoridade, porque validação
 * de cliente não é validação.
 *
 * O contraste usa `contrastRatio()` do resolvedor da F3.0, sobre o tema JÁ
 * resolvido: não adianta checar a cor primária crua, porque o texto sobre ela é
 * derivado por contraste e o esquema claro/escuro vem do fundo.
 */

import {
  contrastRatio,
  resolveTheme,
  type TenantThemeInput,
} from '@/lib/theme/resolve';
import { matchThemePreset, type ThemePreset } from '@/lib/theme/presets';

export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export type BrandingColorField = 'primary' | 'secondary' | 'background';

export interface BrandingDraft {
  primary: string;
  secondary: string;
  background: string;
}

/** Texto corrido e rótulos pequenos. */
export const CONTRAST_TEXT_MIN = 4.5;
/** Componentes de interface (botão sobre o fundo). WCAG 1.4.11. */
export const CONTRAST_UI_MIN = 3;

export interface ContrastIssue {
  label: string;
  ratio: number;
  minimum: number;
  message: string;
}

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

const FIELD_LABEL: Record<BrandingColorField, string> = {
  primary: 'Cor primária',
  secondary: 'Cor secundária',
  background: 'Cor de fundo',
};

export type ParseBrandingColorsResult =
  | { ok: true; value: BrandingDraft; preset: ThemePreset | null }
  | { ok: false; errors: Partial<Record<BrandingColorField, string>> };

/**
 * Lê as três cores de um `FormData`/objeto. Campo ausente ou fora do hex vira
 * erro por campo — a server action nunca grava uma cor não normalizada.
 */
export function parseBrandingColors(
  raw: Partial<Record<BrandingColorField, unknown>>,
): ParseBrandingColorsResult {
  const errors: Partial<Record<BrandingColorField, string>> = {};
  const value = {} as BrandingDraft;

  (Object.keys(FIELD_LABEL) as BrandingColorField[]).forEach((field) => {
    const parsed = normalizeHex(raw[field]);
    if (!parsed) {
      errors[field] = `${FIELD_LABEL[field]} deve ser um hex válido, ex.: #a1b2c3.`;
      return;
    }
    value[field] = parsed;
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, value, preset: matchThemePreset(value) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function check(
  issues: ContrastIssue[],
  label: string,
  foreground: string,
  background: string,
  minimum: number,
): void {
  const ratio = contrastRatio(foreground, background);
  // Tolerância de 1e-9 porque 4.5 calculado por canal pode dar 4.499999.
  if (ratio + 1e-9 >= minimum) return;
  issues.push({
    label,
    ratio: round(ratio),
    minimum,
    message: `${label} com contraste ${round(ratio)}:1 (o mínimo é ${minimum}:1).`,
  });
}

/**
 * Avisos de legibilidade. Cada par é um uso real do tema no portal:
 * fundo × texto; primária × texto derivado sobre ela; primária × fundo (o botão
 * precisa aparecer) e secundária × fundo (badges/descrições).
 */
export function assessContrast(draft: BrandingDraft): ContrastIssue[] {
  const input: TenantThemeInput = {
    colorPrimary: draft.primary,
    colorSecondary: draft.secondary,
    colorBackground: draft.background,
  };
  const theme = resolveTheme(input);
  const issues: ContrastIssue[] = [];

  check(issues, 'Texto sobre o fundo', theme.foreground, theme.background, CONTRAST_TEXT_MIN);
  check(issues, 'Texto sobre a cor primária', theme.primaryForeground, theme.primary, CONTRAST_TEXT_MIN);
  check(issues, 'Cor primária sobre o fundo', theme.primary, theme.background, CONTRAST_UI_MIN);
  check(issues, 'Cor secundária sobre o fundo', theme.secondary, theme.background, CONTRAST_TEXT_MIN);

  return issues;
}
