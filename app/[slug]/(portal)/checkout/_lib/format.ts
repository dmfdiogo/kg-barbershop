// Formatação de dinheiro e duração vive em lib/money.ts, ponto único do
// projeto. Reexportado aqui para não quebrar os imports existentes.
export { formatCents, formatDuration } from '@/lib/money';

/**
 * Formatação da tela de checkout (F4.2). Duplicação pequena e deliberada do
 * formatador do agendamento: o checkout evolui por conta própria e não deve
 * depender de arquivos internos do fluxo da F3.3.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "MM:SS" para o contador do hold. */
export function countdownLabel(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}

export function dateTimeLabel(instant: string, timezone: string): string {
  const date = new Date(instant);
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${day} às ${time}`;
}
