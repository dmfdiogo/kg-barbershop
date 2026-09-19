import type { TenantContext } from '@/lib/tenant/context';
import type { TenantTransaction } from '@/lib/tenant/db';
import {
  getAnyStaffAvailability,
  isBookingOccupying,
  tenantDayRange,
  type BusyBooking,
  type StaffSchedule,
} from '@/lib/booking/availability';
import type { BookingOptions, ServiceSummary, SlotOption, StaffSummary } from './types';
import { tenantDateString, timeLabel, upcomingDays } from './format';

/**
 * Leitura de dados do fluxo de agendamento (F3.3) e ponte para a grade pura da
 * F3.1.
 *
 * Toda consulta passa pelo client escopado — a RLS garante que um portal nunca
 * enxergue staff, jornada ou agendamento de outro tenant, mesmo que uma query
 * "esqueça" o `where`. O domínio de horários (`lib/booking/availability.ts`)
 * permanece puro: aqui só se carrega o que ele precisa.
 */

const BOOKING_SELECT = {
  startsAt: true,
  blockedUntil: true,
  status: true,
  holdExpiresAt: true,
} as const;

async function loadService(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
): Promise<ServiceSummary | null> {
  return tx.service.findFirst({
    where: { id: serviceId, tenantId, active: true },
    select: {
      id: true,
      name: true,
      durationMin: true,
      bufferMin: true,
      priceCents: true,
      paymentMode: true,
      depositCents: true,
      depositPercent: true,
    },
  });
}

async function loadStaffForService(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
): Promise<StaffSummary[]> {
  const staff = await tx.staffProfile.findMany({
    where: {
      tenantId,
      active: true,
      staffServices: { some: { serviceId } },
    },
    select: {
      id: true,
      tenantMember: { select: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return staff.map((profile) => ({
    id: profile.id,
    name: profile.tenantMember.user.name,
  }));
}

export interface DayPolicies {
  minAdvanceMinutes: number;
  maxAdvanceMinutes: number | null;
}

export interface LoadedDay {
  date: string;
  timezone: string;
  service: ServiceSummary;
  /** Só os profissionais que atendem o serviço — a grade recebe a lista filtrada. */
  staff: StaffSchedule[];
  names: Record<string, string>;
  policies: DayPolicies;
}

/**
 * Carrega jornada, bloqueios e agendamentos do dia para os profissionais que
 * atendem o serviço. Quando `staffId` é informado, restringe a ele (e devolve
 * `null` se ele não atende o serviço).
 */
export async function loadDayState(
  ctx: TenantContext,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<LoadedDay | null> {
  const timezone = ctx.tenant.timezone;

  return ctx.forTenant(async (tx) => {
    const service = await loadService(tx, ctx.tenant.id, serviceId);
    if (!service) return null;

    // Antecedência é política do tenant e NÃO está na projeção de roteamento
    // (lib/tenant/context.ts): a leitura é de dado de negócio, então passa pelo
    // client escopado como o resto.
    const tenantPolicy = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: { minAdvanceMinutes: true, maxAdvanceMinutes: true },
    });

    const allStaff = await loadStaffForService(tx, ctx.tenant.id, serviceId);
    const selected = staffId === null ? allStaff : allStaff.filter((s) => s.id === staffId);
    if (selected.length === 0) return null;

    const staffIds = selected.map((s) => s.id);
    const { start, end } = tenantDayRange(date, timezone);

    const workingHours = await tx.workingHours.findMany({
      where: { tenantId: ctx.tenant.id, staffId: { in: staffIds } },
      select: { staffId: true, weekday: true, startTime: true, endTime: true },
    });
    const timeOff = await tx.timeOff.findMany({
      where: {
        tenantId: ctx.tenant.id,
        staffId: { in: staffIds },
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
      select: { staffId: true, startsAt: true, endsAt: true },
    });
    const bookings = await tx.booking.findMany({
      where: {
        tenantId: ctx.tenant.id,
        staffId: { in: staffIds },
        startsAt: { lt: end },
        blockedUntil: { gt: start },
        status: { in: ['HOLD', 'PENDING', 'CONFIRMED'] },
      },
      select: { ...BOOKING_SELECT, staffId: true },
    });

    const staff: StaffSchedule[] = selected.map((member) => ({
      staffId: member.id,
      workingHours: workingHours
        .filter((hours) => hours.staffId === member.id)
        // `@db.Time` é timezone-naive: o relógio de parede está no horário UTC
        // do Date devolvido pelo driver (o seed grava 09:00 como 09:00Z). Ler
        // com getUTC* devolve exatamente a hora de parede configurada.
        .map((hours) => ({
          weekday: hours.weekday,
          startTime: wallClock(hours.startTime),
          endTime: wallClock(hours.endTime),
        })),
      timeOff: timeOff
        .filter((block) => block.staffId === member.id)
        .map((block) => ({ startsAt: block.startsAt, endsAt: block.endsAt })),
      bookings: bookings
        .filter((booking) => booking.staffId === member.id)
        .map(
          (booking): BusyBooking => ({
            startsAt: booking.startsAt,
            blockedUntil: booking.blockedUntil,
            status: booking.status,
            holdExpiresAt: booking.holdExpiresAt,
          }),
        ),
    }));

    return {
      date,
      timezone,
      service,
      staff,
      names: Object.fromEntries(selected.map((member) => [member.id, member.name])),
      policies: {
        minAdvanceMinutes: tenantPolicy.minAdvanceMinutes,
        maxAdvanceMinutes: tenantPolicy.maxAdvanceMinutes,
      },
    };
  });
}

/** Número de dias ofertados no seletor. Curto de propósito: mobile-first. */
export const PORTAL_DAY_WINDOW = 7;

/**
 * Opções iniciais da página `/[slug]/agendar`: serviço do `?servico=`, os
 * profissionais que o atendem e os próximos dias. Devolve `null` quando o
 * serviço não existe/não está ativo NESTE tenant — a página mostra o caminho de
 * volta ao catálogo em vez de um 404 seco.
 */
export async function loadBookingOptions(
  ctx: TenantContext,
  serviceId: string,
  now: Date = new Date(),
): Promise<BookingOptions | null> {
  const timezone = ctx.tenant.timezone;

  const loaded = await ctx.forTenant(async (tx) => {
    const service = await loadService(tx, ctx.tenant.id, serviceId);
    if (!service) return null;
    const staff = await loadStaffForService(tx, ctx.tenant.id, serviceId);
    return { service, staff };
  });

  if (!loaded) return null;

  return {
    service: loaded.service,
    staff: loaded.staff,
    timezone,
    dates: upcomingDays(timezone, PORTAL_DAY_WINDOW, now),
  };
}

/** Horários disponíveis do dia, já rotulados no fuso do tenant. */
export function buildSlotOptions(loaded: LoadedDay, now: Date): SlotOption[] {
  const slots = getAnyStaffAvailability({
    date: loaded.date,
    timezone: loaded.timezone,
    service: loaded.service,
    staff: loaded.staff,
    now,
    minAdvanceMinutes: loaded.policies.minAdvanceMinutes,
    maxAdvanceMinutes: loaded.policies.maxAdvanceMinutes,
  });

  return slots.map((value) => ({
    value,
    label: timeLabel(new Date(value), loaded.timezone),
  }));
}

/**
 * Carga do dia por profissional: nº de agendamentos que ocupam a agenda
 * (HOLD vigente + CONFIRMED). É o critério de distribuição do "qualquer
 * profissional" (contrato da F3.1) — espalhar o trabalho do dia, não igualar
 * placar histórico.
 */
export function buildLoads(loaded: LoadedDay, now: Date): Record<string, number> {
  const loads: Record<string, number> = {};
  for (const member of loaded.staff) {
    loads[member.staffId] = (member.bookings ?? []).filter((booking) =>
      isBookingOccupying(booking, now),
    ).length;
  }
  return loads;
}

/** Data de calendário do tenant para um instante UTC. */
export function dayOfInstant(instant: Date, timezone: string): string {
  return tenantDateString(instant, timezone);
}

function wallClock(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
