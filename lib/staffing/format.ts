/**
 * Formatação de data/hora da equipe (tarefa F2.2), segura para o cliente.
 *
 * Os conflitos chegam como ISO UTC; a exibição é sempre no relógio do tenant,
 * nunca no fuso do navegador — o dono precisa reconhecer o horário que vê na
 * agenda dele.
 */
export function formatConflictDateTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
