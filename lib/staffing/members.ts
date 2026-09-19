import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import { findBookingsOverlapping, findUncoveredBookings, type OccupyingBooking } from './schedule';
import { minutesToTimeColumn, toWorkingHoursView } from './time';
import {
  OCCUPYING_BOOKING_STATUSES,
  type InviteMemberResult,
  type StaffConflictView,
  type StaffMemberView,
  type StaffServicesResult,
  type StaffingFailure,
  type TimeOffResult,
  type TimeOffView,
  type ValidatedInvite,
  type ValidatedTimeOff,
  type ValidatedWeekday,
  type WeeklyScheduleResult,
} from './types';

/**
 * Núcleo de dados de equipe e jornadas (tarefa F2.2).
 *
 * Funções de banco que recebem uma transação JÁ escopada pelo tenant e o
 * `tenantId` — como o catálogo da F2.1. Não abrem transação, não conhecem
 * `next/headers` e são reexecutáveis sob o retry do client escopado.
 *
 * A regra que dá nome à tarefa: reduzir jornada ou criar bloqueio NÃO apaga
 * agendamento. Nenhuma função daqui toca em `Booking` — só consulta. A decisão
 * do dono é um parâmetro (`confirmConflicts`), e sem ele a operação é recusada
 * com a lista de conflitos.
 */

interface StaffProfileRow {
  id: string;
  active: boolean;
  bio: string | null;
  tenantMemberId: string;
  tenantMember: {
    role: 'OWNER' | 'STAFF' | 'CUSTOMER';
    user: { id: string; name: string; phone: string };
  };
}

const STAFF_PROFILE_SELECT = {
  id: true,
  active: true,
  bio: true,
  tenantMemberId: true,
  tenantMember: {
    select: {
      role: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  },
} satisfies Prisma.StaffProfileSelect;

interface BookingRow {
  id: string;
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
  customerId: string | null;
  serviceId: string;
}

/**
 * Carrega os profissionais do tenant. As três leituras são SEQUENCIAIS de
 * propósito: o adapter-pg não gosta de queries concorrentes na mesma transação
 * interativa (nota em `lib/tenant/db.ts`), e um `include` de várias relações
 * independentes faria exatamente isso.
 */
async function loadStaff(
  tx: TenantTransaction,
  tenantId: string,
  staffId?: string,
): Promise<StaffMemberView[]> {
  const profiles = await tx.staffProfile.findMany({
    where: staffId ? { tenantId, id: staffId } : { tenantId },
    orderBy: { createdAt: 'asc' },
    select: STAFF_PROFILE_SELECT,
  });
  if (profiles.length === 0) return [];

  const ids = profiles.map((profile) => profile.id);

  const hours = await tx.workingHours.findMany({
    where: { tenantId, staffId: { in: ids } },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
    select: { staffId: true, weekday: true, startTime: true, endTime: true },
  });

  const links = await tx.staffService.findMany({
    where: { tenantId, staffId: { in: ids } },
    select: { staffId: true, serviceId: true },
  });

  const hoursByStaff = new Map<string, StaffMemberView['workingHours']>();
  for (const row of hours) {
    const view = toWorkingHoursView(row);
    if (!view) continue;
    const list = hoursByStaff.get(row.staffId) ?? [];
    list.push(view);
    hoursByStaff.set(row.staffId, list);
  }

  const servicesByStaff = new Map<string, string[]>();
  for (const link of links) {
    const list = servicesByStaff.get(link.staffId) ?? [];
    list.push(link.serviceId);
    servicesByStaff.set(link.staffId, list);
  }

  return (profiles as StaffProfileRow[]).map((profile) => ({
    id: profile.id,
    memberId: profile.tenantMemberId,
    userId: profile.tenantMember.user.id,
    name: profile.tenantMember.user.name,
    phone: profile.tenantMember.user.phone,
    role: profile.tenantMember.role,
    bio: profile.bio,
    active: profile.active,
    workingHours: hoursByStaff.get(profile.id) ?? [],
    serviceIds: servicesByStaff.get(profile.id) ?? [],
  }));
}

export async function listStaffMembers(
  tx: TenantTransaction,
  tenantId: string,
): Promise<StaffMemberView[]> {
  return loadStaff(tx, tenantId);
}

export async function getStaffMember(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
): Promise<StaffMemberView | null> {
  const rows = await loadStaff(tx, tenantId, staffId);
  return rows[0] ?? null;
}

async function loadFutureBookings(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  now: Date,
): Promise<BookingRow[]> {
  return tx.booking.findMany({
    where: {
      tenantId,
      staffId,
      startsAt: { gte: now },
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      blockedUntil: true,
      customerId: true,
      serviceId: true,
    },
  });
}

function toOccupying(row: BookingRow): OccupyingBooking {
  return { id: row.id, startsAt: row.startsAt, blockedUntil: row.blockedUntil };
}

/**
 * Monta a lista exibível de conflitos. As duas leituras auxiliares são
 * sequenciais pelo mesmo motivo de `loadStaff`.
 */
async function buildConflictViews(
  tx: TenantTransaction,
  tenantId: string,
  rows: BookingRow[],
  kind: StaffConflictView['kind'],
): Promise<StaffConflictView[]> {
  if (rows.length === 0) return [];

  const customerIds = [
    ...new Set(rows.map((row) => row.customerId).filter((id): id is string => id !== null)),
  ];
  const serviceIds = [...new Set(rows.map((row) => row.serviceId))];

  const customers =
    customerIds.length > 0
      ? await tx.tenantMember.findMany({
          where: { tenantId, id: { in: customerIds } },
          select: { id: true, user: { select: { name: true } } },
        })
      : [];
  const services =
    serviceIds.length > 0
      ? await tx.service.findMany({
          where: { tenantId, id: { in: serviceIds } },
          select: { id: true, name: true },
        })
      : [];

  const customerName = new Map(customers.map((row) => [row.id, row.user.name]));
  const serviceName = new Map(services.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    bookingId: row.id,
    customerName: row.customerId ? customerName.get(row.customerId) ?? 'Cliente' : 'Cliente',
    serviceName: serviceName.get(row.serviceId) ?? 'Serviço',
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    kind,
  }));
}

async function assessScheduleConflictRows(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  schedule: readonly ValidatedWeekday[],
  timezone: string,
  now: Date,
): Promise<BookingRow[]> {
  const bookings = await loadFutureBookings(tx, tenantId, staffId, now);
  const uncovered = findUncoveredBookings(bookings.map(toOccupying), schedule, timezone);
  if (uncovered.length === 0) return [];
  const uncoveredIds = new Set(uncovered.map((booking) => booking.id));
  return bookings.filter((booking) => uncoveredIds.has(booking.id));
}

/** Conflitos que a jornada proposta criaria, já prontos para a tela. */
export async function assessScheduleConflicts(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  schedule: readonly ValidatedWeekday[],
  timezone: string,
  now: Date = new Date(),
): Promise<StaffConflictView[]> {
  const rows = await assessScheduleConflictRows(tx, tenantId, staffId, schedule, timezone, now);
  return buildConflictViews(tx, tenantId, rows, 'SCHEDULE');
}

function notFound(): StaffingFailure {
  return { ok: false, code: 'NOT_FOUND', message: 'Profissional não encontrado.' };
}

export interface ConflictAwareOptions {
  now?: Date;
  /** Decisão explícita do dono depois de ver a lista de conflitos. */
  confirmConflicts?: boolean;
}

/**
 * Substitui a jornada semanal do profissional. Se a nova jornada deixar algum
 * agendamento futuro descoberto, devolve `CONFLICTS` com a lista e NÃO grava
 * nada; gravar exige `confirmConflicts: true`. Em nenhum caminho um agendamento
 * é removido.
 */
export async function replaceWeeklySchedule(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  schedule: readonly ValidatedWeekday[],
  timezone: string,
  options: ConflictAwareOptions = {},
): Promise<WeeklyScheduleResult> {
  const staff = await tx.staffProfile.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  if (!staff) return notFound();

  const now = options.now ?? new Date();
  const rows = await assessScheduleConflictRows(tx, tenantId, staffId, schedule, timezone, now);
  const conflicts = await buildConflictViews(tx, tenantId, rows, 'SCHEDULE');
  if (conflicts.length > 0 && !options.confirmConflicts) {
    return {
      ok: false,
      code: 'CONFLICTS',
      message: 'A nova jornada deixa agendamentos fora do horário. Confirme para salvar mesmo assim.',
      conflicts,
    };
  }

  await tx.workingHours.deleteMany({ where: { tenantId, staffId } });
  const data = schedule.flatMap((day) =>
    day.ranges.map((range) => ({
      tenantId,
      staffId,
      weekday: day.weekday,
      startTime: minutesToTimeColumn(range.startMin),
      endTime: minutesToTimeColumn(range.endMin),
    })),
  );
  if (data.length > 0) {
    await tx.workingHours.createMany({ data });
  }

  return { ok: true };
}

async function assessTimeOffConflictRows(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  timeOff: Pick<ValidatedTimeOff, 'startsAt' | 'endsAt'>,
  now: Date,
): Promise<BookingRow[]> {
  const bookings = await loadFutureBookings(tx, tenantId, staffId, now);
  const overlapping = findBookingsOverlapping(
    bookings.map(toOccupying),
    timeOff.startsAt,
    timeOff.endsAt,
  );
  if (overlapping.length === 0) return [];
  const overlappingIds = new Set(overlapping.map((booking) => booking.id));
  return bookings.filter((booking) => overlappingIds.has(booking.id));
}

/** Conflitos que um bloqueio pontual criaria, já prontos para a tela. */
export async function assessTimeOffConflicts(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  timeOff: Pick<ValidatedTimeOff, 'startsAt' | 'endsAt'>,
  now: Date = new Date(),
): Promise<StaffConflictView[]> {
  const rows = await assessTimeOffConflictRows(tx, tenantId, staffId, timeOff, now);
  return buildConflictViews(tx, tenantId, rows, 'TIME_OFF');
}

/**
 * Cria um bloqueio pontual (almoço extraordinário, folga, emergência). Mesma
 * regra da jornada: se cobrir agendamento futuro, exige decisão explícita.
 */
export async function createTimeOff(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  input: ValidatedTimeOff,
  options: ConflictAwareOptions = {},
): Promise<TimeOffResult> {
  const staff = await tx.staffProfile.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  if (!staff) return notFound();

  const now = options.now ?? new Date();
  const rows = await assessTimeOffConflictRows(tx, tenantId, staffId, input, now);
  const conflicts = await buildConflictViews(tx, tenantId, rows, 'TIME_OFF');
  if (conflicts.length > 0 && !options.confirmConflicts) {
    return {
      ok: false,
      code: 'CONFLICTS',
      message: 'O bloqueio cobre agendamentos existentes. Confirme para criar mesmo assim.',
      conflicts,
    };
  }

  const created = await tx.timeOff.create({
    data: {
      tenantId,
      staffId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
    },
    select: { id: true, startsAt: true, endsAt: true, reason: true },
  });

  return {
    ok: true,
    timeOff: {
      id: created.id,
      startsAt: created.startsAt.toISOString(),
      endsAt: created.endsAt.toISOString(),
      reason: created.reason,
    },
  };
}

export async function listTimeOff(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  now: Date = new Date(),
): Promise<TimeOffView[]> {
  const rows = await tx.timeOff.findMany({
    where: { tenantId, staffId, endsAt: { gte: now } },
    orderBy: { startsAt: 'asc' },
    select: { id: true, startsAt: true, endsAt: true, reason: true },
  });
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
  }));
}

export async function deleteTimeOff(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  timeOffId: string,
): Promise<boolean> {
  const result = await tx.timeOff.deleteMany({ where: { id: timeOffId, tenantId, staffId } });
  return result.count > 0;
}

/**
 * Convida uma pessoa por telefone. A pessoa vira `TenantMember` com papel
 * STAFF e ganha um `StaffProfile` para jornada e vínculo de serviços. Não existe
 * senha no sistema: o acesso é o MESMO OTP dos clientes, e como o vínculo já
 * existe com papel STAFF, o `ensureMembership` do verify o preserva.
 *
 * Idempotente: convidar de novo devolve o mesmo profissional. Quem já é OWNER
 * não é rebaixado — o convite é recusado. Quem era CUSTOMER no salão é
 * promovido a STAFF (não ganha dois vínculos: o unique é por tenant+usuário).
 */
export async function inviteStaff(
  tx: TenantTransaction,
  tenantId: string,
  input: ValidatedInvite,
): Promise<InviteMemberResult> {
  const existingUser = await tx.user.findUnique({
    where: { phone: input.phone },
    select: { id: true },
  });

  const userId =
    existingUser?.id ??
    (
      await tx.user.create({
        data: { phone: input.phone, name: input.name.length > 0 ? input.name : input.phone },
        select: { id: true },
      })
    ).id;

  const existingMember = await tx.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { id: true, role: true },
  });

  let memberId: string;
  if (existingMember) {
    if (existingMember.role === 'OWNER') {
      return {
        ok: false,
        code: 'ALREADY_OWNER',
        message: 'Essa pessoa já é dona do estabelecimento.',
      };
    }
    if (existingMember.role !== 'STAFF') {
      await tx.tenantMember.update({
        where: { id: existingMember.id },
        data: { role: 'STAFF' },
      });
    }
    memberId = existingMember.id;
  } else {
    const created = await tx.tenantMember.create({
      data: { tenantId, userId, role: 'STAFF' },
      select: { id: true },
    });
    memberId = created.id;
  }

  let profile = await tx.staffProfile.findFirst({
    where: { tenantId, tenantMemberId: memberId },
    select: { id: true },
  });
  if (!profile) {
    profile = await tx.staffProfile.create({
      data: { tenantId, tenantMemberId: memberId },
      select: { id: true },
    });
  }

  const member = await getStaffMember(tx, tenantId, profile.id);
  if (!member) throw new Error('Profissional recém-convidado não encontrado');
  return { ok: true, member };
}

export async function setStaffActive(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  active: boolean,
): Promise<boolean> {
  const result = await tx.staffProfile.updateMany({
    where: { id: staffId, tenantId },
    data: { active },
  });
  return result.count > 0;
}

export async function updateStaffBio(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  bio: string,
): Promise<boolean> {
  const result = await tx.staffProfile.updateMany({
    where: { id: staffId, tenantId },
    data: { bio: bio.length > 0 ? bio : null },
  });
  return result.count > 0;
}

/**
 * Substitui o vínculo profissional × serviços. Ids de outro tenant (ou
 * inexistentes) são descartados — a query filtra por `tenantId`.
 */
export async function replaceStaffServices(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  serviceIds: readonly string[],
): Promise<StaffServicesResult> {
  const staff = await tx.staffProfile.findFirst({
    where: { id: staffId, tenantId },
    select: { id: true },
  });
  if (!staff) return notFound();

  await tx.staffService.deleteMany({ where: { tenantId, staffId } });

  if (serviceIds.length > 0) {
    const services = await tx.service.findMany({
      where: { tenantId, id: { in: [...serviceIds] } },
      select: { id: true },
    });
    if (services.length > 0) {
      await tx.staffService.createMany({
        data: services.map((service) => ({ tenantId, staffId, serviceId: service.id })),
        skipDuplicates: true,
      });
    }
  }

  const links = await tx.staffService.findMany({
    where: { tenantId, staffId },
    select: { serviceId: true },
  });
  return { ok: true, serviceIds: links.map((link) => link.serviceId) };
}
