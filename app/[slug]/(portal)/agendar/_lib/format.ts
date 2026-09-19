import type { DayOption, ServiceSummary } from './types';

/**
 * Formatação do fluxo de agendamento (F3.3).
 *
 * Toda conversão de instante para texto acontece no fuso do tenant
 * (`Tenant.timezone`) por `Intl` com `timeZone` explícito — nunca pelo fuso do
 * navegador/servidor. É o mesmo cuidado da grade (F3.1): o bug histórico do MVP
 * era decidir o dia em UTC e jogar o agendamento das 22h para o dia seguinte.
 */

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Data de calendário do tenant de um instante UTC, no formato "YYYY-MM-DD". */
export function tenantDateString(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Hora local do tenant, "HH:mm". */
export function timeLabel(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(instant);
}

/** "sábado, 19 de setembro às 10:30", no fuso do tenant. */
export function dateTimeLabel(instant: Date, timezone: string): string {
  const day = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(instant);
  return `${day} às ${timeLabel(instant, timezone)}`;
}

/**
 * Próximos `count` dias de calendário do tenant, a partir do dia de `now`.
 *
 * O rótulo é derivado de uma data de calendário (meio-dia UTC) formatada em
 * UTC: assim o dia da semana exibido é o do calendário do tenant, sem depender
 * do fuso de quem renderiza.
 */
export function upcomingDays(timezone: string, count: number, now: Date): DayOption[] {
  const start = tenantDateString(now, timezone);
  const [yearRaw, monthRaw, dayRaw] = start.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const weekdayFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'short',
  });
  const dayMonthFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
  });

  const days: DayOption[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const calendar = new Date(Date.UTC(year, month - 1, day + offset, 12));
    const date = calendar.toISOString().slice(0, 10);
    days.push({
      date,
      weekday: weekdayFormatter.format(calendar).replace('.', ''),
      dayMonth: dayMonthFormatter.format(calendar),
    });
  }
  return days;
}

/** Rótulo da modalidade de cobrança (mesma copy do catálogo da F3.0). */
export function paymentModeLabel(service: ServiceSummary): string {
  switch (service.paymentMode) {
    case 'FULL_PREPAID':
      return 'Pagamento online';
    case 'DEPOSIT':
      if (service.depositCents && service.depositCents > 0) {
        return `Sinal de ${formatCents(service.depositCents)}`;
      }
      if (service.depositPercent && service.depositPercent > 0) {
        return `Sinal de ${service.depositPercent}%`;
      }
      return 'Sinal antecipado';
    case 'ON_SITE':
      return 'Pagamento no local';
  }
}

export function formatCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** "MM:SS" para o contador do hold. */
export function countdownLabel(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${pad(Math.floor(totalSeconds / 60))}:${pad(totalSeconds % 60)}`;
}
