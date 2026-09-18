import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda de aceite da F0.4: componentes compartilhados não podem conter cor
 * literal — o white-label depende de token de tema (`contexto-comum.md` §2).
 * Varre `components/**` em vez de confiar em revisão manual.
 */

const COMPONENTS_DIR = join(process.cwd(), 'components');

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab|color-mix)\s*\(/i;

const PALETTE_NAMES =
  'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_UTILITIES =
  'bg|text|border|ring|shadow|from|via|to|fill|stroke|divide|outline|placeholder|decoration|caret|accent';
const PALETTE_CLASS = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(?:${PALETTE_NAMES})(?:-\\d{2,3})?(?:\\/\\d+)?\\b`,
);

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

const componentFiles = listFiles(COMPONENTS_DIR).filter(
  (file) => file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.css'),
);

describe('componentes compartilhados — nenhuma cor literal', () => {
  it('encontra os arquivos de components/', () => {
    expect(componentFiles.length).toBeGreaterThan(0);
  });

  it.each(componentFiles)('%s usa apenas tokens de tema', (file) => {
    const source = readFileSync(file, 'utf8');
    const displayName = relative(process.cwd(), file);

    expect(source, `${displayName}: cor hexadecimal`).not.toMatch(HEX_COLOR);
    expect(source, `${displayName}: função de cor (rgb/hsl/oklch)`).not.toMatch(FUNCTIONAL_COLOR);
    expect(source, `${displayName}: classe de paleta do Tailwind`).not.toMatch(PALETTE_CLASS);
  });
});
