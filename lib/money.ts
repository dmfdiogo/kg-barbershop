/**
 * Formatação de dinheiro — ponto único do projeto.
 *
 * Existia em cinco lugares (`app/dev`, checkout, portal, catálogo), escritos
 * por agentes diferentes que não se falaram. As saídas coincidiam, então não
 * havia inconsistência visível — mas cinco cópias significam cinco lugares para
 * achar no dia em que o formato mudar, e a probabilidade de encontrar todos é
 * baixa.
 *
 * Valores circulam em CENTAVOS (inteiro) em todo o sistema; a conversão para
 * texto acontece só aqui, na exibição. O parse da entrada do usuário vive em
 * `lib/catalog/money.ts`, que trata o caminho inverso com aritmética inteira.
 */

/**
 * Sem `Intl.NumberFormat`, de propósito.
 *
 * O `Intl` com `pt-BR` insere ESPAÇO NÃO-QUEBRÁVEL (U+00A0) entre "R$" e o
 * número, e o caractere muda conforme a versão do ICU embarcada no runtime.
 * Isso torna a saída instável entre máquinas e produz o pior tipo de teste
 * falhando: `expected 'R$ 0,00' to be 'R$ 0,00'`, com as duas strings idênticas
 * na tela.
 *
 * Foi exatamente essa a divergência entre as cinco implementações que existiam:
 * quatro usavam `Intl`, uma montava a string à mão. Ninguém tinha percebido,
 * porque o NBSP é invisível.
 *
 * Aritmética inteira também aqui: dividir centavos por 100 para formatar
 * reintroduz ponto flutuante no único lugar onde ele ainda não estava.
 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const reais = Math.trunc(abs / 100);
  const centavos = abs % 100;
  const grouped = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${grouped},${String(centavos).padStart(2, '0')}`;
}

/** Minutos → "30 min" ou "1 h 30 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
