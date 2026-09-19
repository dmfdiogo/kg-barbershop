/**
 * Validação do upload de logo (tarefa F2.3).
 *
 * O TIPO É DECIDIDO PELO CONTEÚDO, NUNCA PELA EXTENSÃO. Um `.png` que na
 * verdade é HTML, ou um `.jpg` renomeado, seria servido com o tipo errado e o
 * navegador faria sniffing — daí a assinatura de bytes (magic bytes) de PNG e
 * JPEG. Extensão e `Content-Type` declarados pelo cliente não entram na
 * decisão.
 *
 * SVG É TEXTO E PODE CONTER SCRIPT. Diferente de PNG/JPEG, SVG é XML: aceita
 * `<script>`, atributos `on*` e `href="javascript:…"`. Em vez de tentar
 * "limpar" (sanitizar por regex é contornável), a validação RECUSA qualquer SVG
 * que apresente construção ativa — o arquivo nunca é persistido nem chega ao
 * `<img>` do portal. Isso é mais forte que servir com CSP: o payload perigoso
 * nem existe no estado salvo. Como o logo aparece via `<img src="data:…">`,
 * scripts em SVG já não executam; a recusa é a segunda camada.
 *
 * O limite de tamanho é do ARQUIVO CRU (não do base64). O logo é guardado como
 * data URL na coluna `Tenant.logoUrl` — não há storage externo até a fase 8, e
 * a data URL dispensa um route handler e uma migração de schema.
 */

/** Tamanho máximo do arquivo cru. Base64 cresce ~33%, então ~341 KB no banco. */
export const LOGO_MAX_BYTES = 256 * 1024;

/** `accept` do input: o tipo real continua sendo checado no servidor. */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml';

export type LogoMime = 'image/png' | 'image/jpeg' | 'image/svg+xml';

export type LogoValidation =
  | { ok: true; mime: LogoMime; dataUrl: string; byteLength: number }
  | { ok: false; code: LogoErrorCode; message: string };

export type LogoErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'unsafe_svg'
  | 'invalid_encoding';

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** Construções que nunca são permitidas num SVG de logo. */
const DANGEROUS_SVG: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /<\s*script\b/i, label: 'script' },
  { pattern: /<\s*foreignObject\b/i, label: 'foreignObject' },
  { pattern: /<\s*iframe\b/i, label: 'iframe' },
  { pattern: /<\s*object\b/i, label: 'object' },
  { pattern: /<\s*embed\b/i, label: 'embed' },
  { pattern: /<\s*!ENTITY\b/i, label: 'ENTITY' },
  { pattern: /<!DOCTYPE[^>]*\[/i, label: 'internal DTD subset' },
  // Atributo de evento: sempre precedido de espaço dentro da tag.
  { pattern: /\son[a-z]+\s*=/i, label: 'event handler' },
  { pattern: /javascript:/i, label: 'javascript: URL' },
  // Só permitimos referências internas (`#id`). href/data URL externo sai.
  { pattern: /\b(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, label: 'external href' },
];

export type SvgSanitization =
  | { ok: true; svg: string }
  | { ok: false; code: 'unsafe_svg'; message: string };

/**
 * Aceita o SVG só se ele for inerte. Não reescreve o documento: recusa. A
 * função se chama `sanitize` no sentido de "tornar seguro", e a forma escolhida
 * é rejeitar o que não pode ser garantido — não há como provar que um regex
 * removeu toda construção ativa.
 */
export function sanitizeSvg(source: string): SvgSanitization {
  for (const { pattern, label } of DANGEROUS_SVG) {
    if (pattern.test(source)) {
      return {
        ok: false,
        code: 'unsafe_svg',
        message: `O SVG foi recusado: contém ${label}. Envie um SVG sem scripts ou recursos externos.`,
      };
    }
  }
  return { ok: true, svg: source };
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** `<svg>` depois de BOM, prólogo XML, comentários e DOCTYPE simples. */
function looksLikeSvg(text: string): boolean {
  const stripped = text
    .replace(/^\uFEFF/, '')
    .replace(/^\s+/, '')
    .replace(/^<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^<!--[\s\S]*?-->\s*/g, '')
    .replace(/^<!DOCTYPE[^>]*>\s*/i, '');
  return /^<svg[\s>]/i.test(stripped);
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 sem depender de `Buffer`/`btoa` — funciona em Node e no navegador. */
function toBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];

    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? '=' : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? '=' : BASE64_ALPHABET[third & 0x3f];
  }
  return output;
}

function dataUrl(mime: LogoMime, bytes: Uint8Array): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/**
 * Valida os bytes do arquivo e devolve a data URL pronta para persistir.
 * `declaredMime` existe só para diagnóstico futuro; a decisão é do conteúdo.
 */
export function validateLogoUpload(input: {
  bytes: Uint8Array;
  declaredMime?: string | null;
}): LogoValidation {
  const { bytes } = input;

  if (bytes.byteLength === 0) {
    return { ok: false, code: 'empty', message: 'O arquivo enviado está vazio.' };
  }
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    const limitKb = Math.floor(LOGO_MAX_BYTES / 1024);
    return {
      ok: false,
      code: 'too_large',
      message: `O logo passa de ${limitKb} KB. Envie uma imagem menor.`,
    };
  }

  if (startsWith(bytes, PNG_MAGIC)) {
    return { ok: true, mime: 'image/png', dataUrl: dataUrl('image/png', bytes), byteLength: bytes.byteLength };
  }
  if (startsWith(bytes, JPEG_MAGIC)) {
    return { ok: true, mime: 'image/jpeg', dataUrl: dataUrl('image/jpeg', bytes), byteLength: bytes.byteLength };
  }

  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      ok: false,
      code: 'unsupported_type',
      message: 'Formato não reconhecido. Envie PNG, JPG ou SVG.',
    };
  }

  if (!looksLikeSvg(text)) {
    return {
      ok: false,
      code: 'unsupported_type',
      message: 'O conteúdo do arquivo não é PNG, JPG nem SVG.',
    };
  }

  const sanitized = sanitizeSvg(text);
  if (!sanitized.ok) {
    return { ok: false, code: sanitized.code, message: sanitized.message };
  }

  const encoded = new TextEncoder().encode(sanitized.svg);
  return {
    ok: true,
    mime: 'image/svg+xml',
    dataUrl: dataUrl('image/svg+xml', encoded),
    byteLength: encoded.byteLength,
  };
}
