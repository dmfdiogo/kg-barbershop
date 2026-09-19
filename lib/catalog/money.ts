/**
 * Dinheiro em CENTAVOS, sem float em ponto algum (invariante do projeto).
 *
 * O formulário entrega texto (`"R$ 1.234,50"`, `"50"`, `"50,00"`); a conversão
 * para inteiro usa só aritmética de inteiros e regex. `parseFloat`,
 * `Number(raw)` sobre texto monetário e `* 100` sobre decimal são proibidos —
 * é a origem clássica de 1 centavo perdido no split.
 */

const DIGITS = /^\d+$/;

/**
 * Converte um valor monetário em centavos.
 *
 * Aceita:
 *   - inteiro já em centavos (número seguro, >= 0);
 *   - `"50"`, `"50,00"`, `"50.00"`, `"R$ 1.234,50"`, `"1.234,5"`.
 *
 * Rejeita (devolve `null`): valores negativos, mais de duas casas decimais,
 * texto não numérico e números fracionários (que já seriam reais, não centavos).
 */
export function parseMoneyToCents(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const stripped = raw
    .replace(/[Rr]\$\s?/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (stripped.length === 0 || !/^[0-9.,]+$/.test(stripped)) return null;

  const lastComma = stripped.lastIndexOf(',');
  const lastDot = stripped.lastIndexOf('.');
  let integerPart: string;
  let fractionPart = '';

  if (lastComma > lastDot) {
    // Vírgula é o decimal; pontos são separador de milhar.
    integerPart = stripped.slice(0, lastComma).replace(/[.]/g, '');
    fractionPart = stripped.slice(lastComma + 1).replace(/[.]/g, '');
  } else if (lastDot > -1) {
    const afterDot = stripped.slice(lastDot + 1);
    const dotCount = (stripped.match(/\./g) ?? []).length;
    // Ponto único com 1–2 casas é decimal; caso contrário é milhar.
    if (dotCount === 1 && afterDot.length > 0 && afterDot.length <= 2) {
      integerPart = stripped.slice(0, lastDot).replace(/[,]/g, '');
      fractionPart = afterDot;
    } else {
      integerPart = stripped.replace(/[.]/g, '');
    }
  } else {
    integerPart = stripped;
  }

  if (integerPart.length === 0) integerPart = '0';
  if (fractionPart.length > 2) return null;
  if (!DIGITS.test(integerPart)) return null;
  if (fractionPart.length > 0 && !DIGITS.test(fractionPart)) return null;

  const reais = Number(integerPart);
  if (!Number.isSafeInteger(reais)) return null;
  const centsPart = fractionPart.length > 0 ? Number(fractionPart.padEnd(2, '0')) : 0;

  const cents = reais * 100 + centsPart;
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Formata centavos como `R$ 1.234,50`. Usa `Math.trunc` e `%` (inteiros) em
 * vez de dividir para float e formatar — assim o valor nunca passa por ponto
 * flutuante, nem na exibição.
 */
export function formatCentsToBRL(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const centavos = abs % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${String(centavos).padStart(2, '0')}`;
}

/** Valor para pré-preencher o campo de preço no formulário, sem float. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const abs = Math.abs(cents);
  return `${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Percentual inteiro (1–100). Nunca aceita fração. */
export function parsePercentToInt(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const stripped = raw.replace(/%/g, '').trim();
  if (!DIGITS.test(stripped)) return null;
  const value = Number(stripped);
  return Number.isSafeInteger(value) ? value : null;
}

/** Inteiro com faixa. Base de duração e buffer. */
export function parseIntInRange(raw: unknown, min: number, max: number): number | null {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}
