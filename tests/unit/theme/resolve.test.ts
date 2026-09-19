import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  contrastRatio,
  resolveTheme,
  themeCssText,
  themeCssVariables,
} from '@/lib/theme/resolve';

/**
 * Contrato do resolvedor de tema (F3.0) — o que a F2.3 consome.
 *
 * Os padrões precisam bater com o `:root` de `app/globals.css` (primeiro teste):
 * o portal os injeta por cima, mas as telas fora do portal continuam lendo
 * aquele arquivo. Divergir = duas caras para o mesmo estado vazio.
 */

const GLOBALS_CSS = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

describe('resolveTheme — padrões', () => {
  it('sem cor configurada (null/undefined/vazio), devolve o tema padrão', () => {
    expect(resolveTheme(null)).toEqual(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toEqual(DEFAULT_THEME);
    expect(resolveTheme({})).toEqual(DEFAULT_THEME);
    expect(resolveTheme({ colorPrimary: null, colorSecondary: null, colorBackground: null })).toEqual(
      DEFAULT_THEME,
    );
    expect(DEFAULT_THEME.isDefault).toBe(true);
    expect(DEFAULT_THEME.scheme).toBe('light');
  });

  it('os padrões são os mesmos tokens do :root de globals.css', () => {
    // Só o bloco claro: o @media (prefers-color-scheme: dark) vem depois.
    const lightRoot = GLOBALS_CSS.slice(0, GLOBALS_CSS.indexOf('@media'));

    for (const [name, value] of Object.entries(themeCssVariables(DEFAULT_THEME))) {
      // `--color-primary-foreground` nasce no resolvedor (texto sobre a
      // primária) e não existe no CSS global; os demais são compartilhados.
      if (name === '--color-primary-foreground') continue;
      const declaration = new RegExp(`${name}\\s*:\\s*${value}\\s*;`, 'i');
      expect(lightRoot, `${name} divergiu de globals.css`).toMatch(declaration);
    }
  });
});

describe('resolveTheme — cores do tenant', () => {
  it('usa as três cores do tenant quando configuradas', () => {
    const theme = resolveTheme({
      colorPrimary: '#1c1917',
      colorSecondary: '#b45309',
      colorBackground: '#0c0a09',
    });

    expect(theme).toMatchObject({
      primary: '#1c1917',
      secondary: '#b45309',
      background: '#0c0a09',
      isDefault: false,
    });
  });

  it('fundo escuro deriva texto claro e a variante escura das funcionais', () => {
    const theme = resolveTheme({ colorBackground: '#0c0a09' });

    expect(theme.scheme).toBe('dark');
    expect(theme.foreground).toBe('#fafafa');
    expect(theme.danger).toBe('#f87171');
    expect(theme.isDefault).toBe(false);
  });

  it('fundo claro derivado mantém os tokens funcionais claros', () => {
    const theme = resolveTheme({ colorBackground: '#ffffff' });

    expect(theme.scheme).toBe('light');
    expect(theme.foreground).toBe('#171717');
    expect(theme.danger).toBe('#b91c1c');
  });

  it('configuração parcial completa com os padrões, sem quebrar', () => {
    const theme = resolveTheme({ colorPrimary: '#0f766e' });

    expect(theme.primary).toBe('#0f766e');
    expect(theme.secondary).toBe(DEFAULT_THEME.secondary);
    expect(theme.background).toBe(DEFAULT_THEME.background);
    expect(theme.foreground).toBe(DEFAULT_THEME.foreground);
  });

  it('texto sobre a primária é o extremo com maior contraste', () => {
    const darkPrimary = resolveTheme({ colorPrimary: '#171717' });
    const lightPrimary = resolveTheme({ colorPrimary: '#fafafa' });

    expect(darkPrimary.primaryForeground).toBe('#fafafa');
    expect(lightPrimary.primaryForeground).toBe('#171717');
    expect(contrastRatio(darkPrimary.primary, darkPrimary.primaryForeground)).toBeGreaterThan(4.5);
  });

  it('accepta hex curto e normaliza para minúsculas', () => {
    const theme = resolveTheme({ colorPrimary: '#ABC', colorBackground: '#FFF' });

    expect(theme.primary).toBe('#abc');
    expect(theme.background).toBe('#fff');
  });
});

describe('resolveTheme — valor inválido não chega ao <style>', () => {
  it('recusa cor fora do formato hex e cai no padrão', () => {
    const theme = resolveTheme({
      colorPrimary: 'red',
      colorSecondary: 'rgb(1,2,3)',
      colorBackground: 'var(--x)',
    });

    expect(theme.primary).toBe(DEFAULT_THEME.primary);
    expect(theme.secondary).toBe(DEFAULT_THEME.secondary);
    expect(theme.background).toBe(DEFAULT_THEME.background);
    expect(theme.isDefault).toBe(true);
  });

  it('tentativa de injeção no <style> vira texto inerte', () => {
    const attack = 'red}</style><script>alert(1)</script>';
    const theme = resolveTheme({ colorPrimary: attack });
    const css = themeCssText(theme);

    expect(theme.primary).toBe(DEFAULT_THEME.primary);
    expect(css).not.toContain('<');
    expect(css).not.toContain('alert');
  });
});

describe('themeCssText', () => {
  it('emite todas as variáveis em :root, com o color-scheme do fundo', () => {
    const css = themeCssText(resolveTheme({ colorPrimary: '#1c1917', colorBackground: '#0c0a09' }));

    expect(css.startsWith(':root{color-scheme:dark;')).toBe(true);
    expect(css).toContain('--color-primary:#1c1917');
    expect(css).toContain('--color-background:#0c0a09');
    expect(css).toContain('--color-danger:#f87171');
    expect(css.endsWith('}')).toBe(true);
  });

  it('tema padrão emite as variáveis padrão', () => {
    const css = themeCssText(DEFAULT_THEME);

    expect(css).toContain('--color-primary:#171717');
    expect(css).toContain('--color-background:#ffffff');
    expect(css).toContain('color-scheme:light');
  });
});
