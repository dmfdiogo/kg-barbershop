// Formatação de dinheiro e duração vive em lib/money.ts, ponto único do
// projeto. Reexportado aqui para não quebrar os imports existentes.
export { formatCents, formatDuration } from '@/lib/money';

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(iso));
}
