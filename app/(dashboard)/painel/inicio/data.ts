import { addDays, addMonths, parseISO } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { BookingStatus } from '@prisma/client';
import { getTrialStatus, type TrialStatus } from '@/lib/billing/trial';
import type { TenantTransaction } from '@/lib/tenant/db';

/**
 * Dashboard operacional (tarefa F2.4).
 *
 * AGENDA INTEIRA NO FUSO DO TENANT: dia e mês são faixas locais convertidas
 * para UTC com `fromZonedTime`, e o dia da semana sai de `toZonedTime(...).getDay()`
 * — nunca `getUTCDay()`, a armadilha que o projeto já pagou (contexto-comum §3).
 *
 * FATURAMENTO SEM F4: enquanto não existe pagamento, o realizado vem dos
 * `Booking` em status que representam receita reconhecida — CONFIRMED e
 * COMPLETED — somando `priceCents`. HOLD, PENDING, CANCELLED e NO_SHOW não
 * entram. Quando a F4 chegar, a fonte passa a ser `Payment` sem mudar a tela.
 *
 * Dinheiro é `Int` em centavos. A formatação mora em `lib/catalog/money.ts`
 * (F2.1) e só acontece na exibição.
 */

export const REVENUE_BOOKING_STATUSES: readonly BookingStatus[] = ['CONFIRMED', 'COMPLETED'];
export const AGENDA_BOOKING_STATUSES: readonly BookingStatus[] = [
  'CONFIRMED',
  'COMPLETED',
  'PENDING',
];

export interface DashboardRevenue {
  dayCents: number;
  monthCents: number;
}

export interface StaffOccupancy {
  staffId: string;
  name: string;
  bookedMinutes: number;
  workingMinutes: number;
  /** 0..1; `null` quando o profissional não tem jornada no dia. */
  rate: number | null;
}

export interface AgendaEntry {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: BookingStatus;
  serviceName: string;
  customerName: string;
  staffName: string;
  priceCents: number;
}

export interface DashboardOverview {
  /** Dia local do tenant, "YYYY-MM-DD". */
  date: string;
  revenue: DashboardRevenue;
  occupancy: StaffOccupancy[];
  agenda: AgendaEntry[];
  /** Estado da trial por valor (F7.1) para o aviso do painel. */
  trial: TrialStatus;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** "YYYY-MM-DD" de um dia-calendário (o Date já representa meia-noite UTC). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dia local do tenant para um instante — `en-CA` devolve "YYYY-MM-DD". */
export function localDateOf(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(instant);
}

function startOfLocalDay(instant: Date, timezone: string): Date {
  return fromZonedTime(`${localDateOf(instant, timezone)}T00:00:00`, timezone);
}

function endOfLocalDay(instant: Date, timezone: string): Date {
  const next = addDays(parseISO(`${localDateOf(instant, timezone)}T00:00:00Z`), 1);
  return fromZonedTime(`${isoDate(next)}T00:00:00`, timezone);
}

function startOfLocalMonth(instant: Date, timezone: string): Date {
  const zoned = toZonedTime(instant, timezone);
  return fromZonedTime(`${zoned.getFullYear()}-${pad(zoned.getMonth() + 1)}-01T00:00:00`, timezone);
}

function endOfLocalMonth(instant: Date, timezone: string): Date {
  const start = startOfLocalMonth(instant, timezone);
  const next = addMonths(parseISO(`${isoDate(start)}T00:00:00Z`), 1);
  return fromZonedTime(`${isoDate(next)}T00:00:00`, timezone);
}

/**
 * Minutos desde a meia-noite de uma coluna `time` do Postgres. O Prisma entrega
 * `@db.Time` como Date no dia 1970-01-01, sem fuso: os componentes UTC são o
 * relógio de parede gravado — a exceção legítima ao "não use UTC para hora de
 * negócio", porque aqui não há data nem fuso, só uma hora do dia.
 */
function timeToMinutes(time: Date): number {
  return time.getUTCHours() * 60 + time.getUTCMinutes();
}

export async function loadDashboard(
  tx: TenantTransaction,
  tenantId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<DashboardOverview> {
  const dayStart = startOfLocalDay(now, timezone);
  const dayEnd = endOfLocalDay(now, timezone);
  const monthStart = startOfLocalMonth(now, timezone);
  const monthEnd = endOfLocalMonth(now, timezone);
  const weekday = toZonedTime(dayStart, timezone).getDay();

  // Queries sequenciais de propósito: o adapter do Prisma carrega relações
  // independentes de um `include` em paralelo na mesma conexão, e o projeto
  // documentou o aviso de compatibilidade (lib/tenant/db.ts). Melhor manter
  // poucas relações por consulta.
  const staff = await tx.staffProfile.findMany({
    where: { tenantId, active: true },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      tenantMember: { select: { user: { select: { name: true } } } },
      workingHours: { select: { weekday: true, startTime: true, endTime: true } },
    },
  });

  const bookings = await tx.booking.findMany({
    where: {
      tenantId,
      startsAt: { gte: dayStart, lt: dayEnd },
      status: { in: [...AGENDA_BOOKING_STATUSES] },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      priceCents: true,
      status: true,
      staffId: true,
      service: { select: { name: true, durationMin: true } },
      customer: { select: { user: { select: { name: true } } } },
    },
  });

  const dayRevenue = await tx.booking.aggregate({
    _sum: { priceCents: true },
    where: {
      tenantId,
      startsAt: { gte: dayStart, lt: dayEnd },
      status: { in: [...REVENUE_BOOKING_STATUSES] },
    },
  });

  const monthRevenue = await tx.booking.aggregate({
    _sum: { priceCents: true },
    where: {
      tenantId,
      startsAt: { gte: monthStart, lt: monthEnd },
      status: { in: [...REVENUE_BOOKING_STATUSES] },
    },
  });

  const staffName = new Map(
    staff.map((profile) => [profile.id, profile.tenantMember.user.name] as const),
  );

  const occupancy: StaffOccupancy[] = staff.map((profile) => {
    const workingMinutes = profile.workingHours
      .filter((hours) => hours.weekday === weekday)
      .reduce((total, hours) => {
        const span = timeToMinutes(hours.endTime) - timeToMinutes(hours.startTime);
        return total + Math.max(0, span);
      }, 0);

    const bookedMinutes = bookings
      .filter((booking) => booking.staffId === profile.id)
      .reduce((total, booking) => total + booking.service.durationMin, 0);

    return {
      staffId: profile.id,
      name: profile.tenantMember.user.name,
      bookedMinutes,
      workingMinutes,
      rate: workingMinutes > 0 ? Math.min(1, bookedMinutes / workingMinutes) : null,
    };
  });

  const agenda: AgendaEntry[] = bookings.map((booking) => ({
    id: booking.id,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    status: booking.status,
    serviceName: booking.service.name,
    customerName: booking.customer?.user.name ?? 'Cliente',
    staffName: staffName.get(booking.staffId) ?? 'Profissional',
    priceCents: booking.priceCents,
  }));

  const trial = await getTrialStatus(tx, tenantId);

  return {
    date: localDateOf(now, timezone),
    revenue: {
      dayCents: dayRevenue._sum.priceCents ?? 0,
      monthCents: monthRevenue._sum.priceCents ?? 0,
    },
    occupancy,
    agenda,
    trial,
  };
}
