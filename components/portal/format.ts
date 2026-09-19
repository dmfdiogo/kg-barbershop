// Formatação de dinheiro e duração vive em lib/money.ts, ponto único do
// projeto. Reexportado aqui para não quebrar os imports existentes.
export { formatCents, formatDuration } from '@/lib/money';

/**
 * Formatação do catálogo (F3.0). O banco guarda centavos (`Int`) e minutos;
 * a apresentação é que formata, em pt-BR.
 */

