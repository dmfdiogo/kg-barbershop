import { describe, expect, it } from 'vitest';
import { THEME_PRESETS, getThemePreset, matchThemePreset } from '@/lib/theme/presets';
import {
  LOGO_MAX_BYTES,
  sanitizeSvg,
  validateLogoUpload,
} from '@/app/(dashboard)/painel/marca/logo';
import {
  assessContrast,
  normalizeHex,
  parseBrandingColors,
} from '@/app/(dashboard)/painel/marca/validation';

/**
 * Núcleo da tela de marca (tarefa F2.3): presets, validação de upload pelo
 * conteúdo e aviso de contraste. Nada aqui depende do runtime do Next — é o
 * que permite testar SVG malicioso sem navegador.
 */

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const encoder = new TextEncoder();

function svg(source: string): Uint8Array {
  return encoder.encode(source);
}

const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#a85a67"/></svg>';

describe('presets da spec §5.1', () => {
  it('traz exatamente os quatro presets nomeados', () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([
      'classic-barber',
      'beauty-spa',
      'pet-friendly',
      'auto-detail',
    ]);
    expect(THEME_PRESETS.map((preset) => preset.name)).toEqual([
      'Classic Barber',
      'Beauty & Spa',
      'Pet Friendly',
      'Auto Detail',
    ]);
  });

  it('todas as cores são hex válido e passam na validação de contraste', () => {
    for (const preset of THEME_PRESETS) {
      expect(normalizeHex(preset.colors.primary)).not.toBeNull();
      expect(normalizeHex(preset.colors.secondary)).not.toBeNull();
      expect(normalizeHex(preset.colors.background)).not.toBeNull();
      expect(assessContrast(preset.colors), preset.name).toEqual([]);
    }
  });

  it('getThemePreset devolve o preset por id e null quando não existe', () => {
    expect(getThemePreset('classic-barber')?.name).toBe('Classic Barber');
    expect(getThemePreset('nao-existe')).toBeNull();
    expect(getThemePreset(null)).toBeNull();
  });

  it('matchThemePreset casa por igualdade estrita e normaliza caixa', () => {
    expect(matchThemePreset({ primary: '#D4A24C', secondary: '#D8CFC0', background: '#0C0A09' })?.id).toBe(
      'classic-barber',
    );
    expect(
      matchThemePreset({ primary: '#d4a24d', secondary: '#d8cfc0', background: '#0c0a09' }),
    ).toBeNull();
  });
});

describe('parseBrandingColors', () => {
  it('normaliza para minúsculas e deriva o preset', () => {
    const result = parseBrandingColors({
      primary: '#D4A24C',
      secondary: '#D8CFC0',
      background: '#0C0A09',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ primary: '#d4a24c', secondary: '#d8cfc0', background: '#0c0a09' });
    expect(result.preset?.id).toBe('classic-barber');
  });

  it('recusa campo ausente ou fora do hex, por campo', () => {
    const result = parseBrandingColors({ primary: 'red', background: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.primary).toBeDefined();
    expect(result.errors.secondary).toBeDefined();
    expect(result.errors.background).toBeDefined();
  });

  it('tema personalizado não casa preset quando uma cor difere', () => {
    const result = parseBrandingColors({
      primary: '#d4a24c',
      secondary: '#ffffff',
      background: '#0c0a09',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preset).toBeNull();
  });
});

describe('assessContrast', () => {
  it('acusa amarelo sobre branco (secundária e primária)', () => {
    const issues = assessContrast({
      primary: '#ffff00',
      secondary: '#ffff00',
      background: '#ffffff',
    });

    expect(issues.map((issue) => issue.label)).toContain('Cor secundária sobre o fundo');
    expect(issues.map((issue) => issue.label)).toContain('Cor primária sobre o fundo');
    expect(issues.every((issue) => issue.ratio < issue.minimum)).toBe(true);
  });

  it('paleta legível não gera aviso', () => {
    expect(
      assessContrast({ primary: '#0369a1', secondary: '#0f766e', background: '#fefce8' }),
    ).toEqual([]);
  });
});

describe('sanitizeSvg', () => {
  it('aceita SVG inerte', () => {
    expect(sanitizeSvg(CLEAN_SVG).ok).toBe(true);
  });

  it.each([
    ['script', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['event handler', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'],
    ['javascript URL', '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)">x</a></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>x</script></body></foreignObject></svg>'],
    ['external href', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png"/></svg>'],
  ])('recusa SVG com %s', (_label, source) => {
    expect(sanitizeSvg(source).ok).toBe(false);
  });
});

describe('validateLogoUpload — tipo pelo conteúdo', () => {
  it('aceita PNG pela assinatura de bytes', () => {
    const result = validateLogoUpload({ bytes: PNG_BYTES, declaredMime: 'image/png' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/png');
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('aceita JPEG e ignora o mime declarado errado', () => {
    const result = validateLogoUpload({ bytes: JPEG_BYTES, declaredMime: 'image/svg+xml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/jpeg');
  });

  it('aceita SVG limpo mesmo declarado como PNG', () => {
    const result = validateLogoUpload({ bytes: svg(CLEAN_SVG), declaredMime: 'image/png' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mime).toBe('image/svg+xml');
  });

  it('recusa SVG com script — o payload nunca vira data URL', () => {
    const malicious = svg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const result = validateLogoUpload({ bytes: malicious, declaredMime: 'image/svg+xml' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unsafe_svg');
    expect((result as { dataUrl?: string }).dataUrl).toBeUndefined();
  });

  it('recusa HTML disfarçado de imagem', () => {
    const html = encoder.encode('<html><body>oi</body></html>');
    const result = validateLogoUpload({ bytes: html, declaredMime: 'image/png' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unsupported_type');
  });

  it('recusa arquivo vazio e acima do limite', () => {
    expect(validateLogoUpload({ bytes: new Uint8Array() }).ok).toBe(false);

    const tooBig = new Uint8Array(LOGO_MAX_BYTES + 1);
    tooBig.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    const result = validateLogoUpload({ bytes: tooBig });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('too_large');
  });
});
