import type { BookingStatus, MemberRole } from '@prisma/client';
import { addDays, format, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { confirmBooking, ConfirmBookingError } from '@/lib/booking/confirm';
import { createHold, HoldError } from '@/lib/booking/hold';
import { isSlotUnavailableError } from '@/lib/tenant/errors';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import type {
  AgendaBookingView,
  AgendaDisplayStatus,
  AgendaFailure,
  AgendaScope,
  AgendaViewMode,
  BookingStampResult,
  WalkInResult,
} from './types';

/**
 * Núcleo de dados da agenda do painel (tarefa F3.5, spec §2.3).
 *
 * Como o catálogo e a equipe: as funções de leitura/mutação recebem uma
 * transação JÁ escopada pelo tenant e o `tenantId`. Não conhecem
 * `next/headers` e são reexecutáveis sob o retry do client escopado.
 *
 * A distinção de permissão entre OWNER e STAFF NÃO é de interface: ela é
 * resolvida aqui (`resolveAgendaScope`) e vaza para o servidor inteiro. O STAFF
 * só enxerga o próprio `StaffProfile` — pedir o id de um colega, seja por query
 * ou path, devolve `null` e a página responde 404. O OWNER pode filtrar por
 * qualquer profissional do tenant (ou ver todos).
 *
 * O walk-in é criado pelo fluxo de hold + confirmação da F3.2, para reusar a
 * exclusion constraint e os pontos de extensão (participantes e eventos). Ele
 * pula a antecedência mínima de propósito — é gente de pé no balcão — mas
 * NUNCA o anti-overlap: a violação chega como `SlotUnavailableError` e vira
 * mensagem de domínio, não 500.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Hoje no fuso do tenant, "YYYY-MM-DD" — nunca `toISOString().slice(0,10)` (UTC). */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return formatInTimeZone(now, timezone, 'yyyy-MM-dd');
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY.test(value)) return false;
  const parsed = fromZonedTime(`${value}T00:00:00`, 'UTC');
  return !Number.isNaN(parsed.getTime()) && formatInTimeZone(parsed, 'UTC', 'yyyy-MM-dd') === value;
}

function shiftDateKey(date: string, days: number): string {
  return format(addDays(parseISO(date), days), 'yyyy-MM-dd');
}

export interface AgendaRange {
  /** Instante UTC inclusivo. */
  start: Date;
  /** Instante UTC exclusivo. */
  end: Date;
}

/**
 * Intervalo UTC coberto pela visão. Dia é o dia local do tenant; semana começa
 * no domingo local (a mesma convenção 0=domingo do schema e do `CalendarView`).
 * A aritmética do dia acontece no fuso do tenant, nunca em UTC.
 */
export function agendaRange(view: AgendaViewMode, date: string, timezone: string): AgendaRange {
  const start = fromZonedTime(`${date}T00:00:00`, timezone);
  if (view === 'day') {
    return { start, end: fromZonedTime(`${shiftDateKey(date, 1)}T00:00:00`, timezone) };
  }

  const weekday = toZonedTime(start, timezone).getDay();
  return {
    start: fromZonedTime(`${shiftDateKey(date, -weekday)}T00:00:00`, timezone),
    end: fromZonedTime(`${shiftDateKey(date, 7 - weekday)}T00:00:00`, timezone),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function bookingDisplayStatus(
  status: BookingStatus,
  hasPaid: boolean,
): AgendaDisplayStatus {
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'NO_SHOW') return 'NO_SHOW';
  if (status === 'CANCELLED') return 'CANCELLED';
  if (status === 'CONFIRMED') return hasPaid ? 'PAID' : 'CONFIRMED';
  return 'PENDING';
}

export interface LoadAgendaInput {
  /** `StaffProfile.id`; nulo/ausente = todos os profissionais (apenas OWNER). */
  staffId?: string | null;
  start: Date;
  end: Date;
  now?: Date;
}

/**
 * Atendimentos do intervalo, com nomes legíveis e o status exibível.
 *
 * As leituras auxiliares são SEQUENCIAIS de propósito: o adapter-pg não gosta
 * de queries concorrentes na mesma transação interativa (nota em
 * `lib/tenant/db.ts`). Holds vencidos nunca aparecem — o horário volta à grade
 * antes de qualquer limpeza.
 */
export async function loadAgendaBookings(
  tx: TenantTransaction,
  tenantId: string,
  input: LoadAgendaInput,
): Promise<AgendaBookingView[]> {
  const now = input.now ?? new Date();

  const rows = await tx.booking.findMany({
    where: {
      tenantId,
      ...(input.staffId ? { staffId: input.staffId } : {}),
      startsAt: { gte: input.start, lt: input.end },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      status: true,
      startsAt: true,
      endsAt: true,
      staffId: true,
      serviceId: true,
      customerId: true,
      priceCents: true,
      source: true,
      completedAt: true,
      noShowAt: true,
      holdExpiresAt: true,
    },
  });

  const visible = rows.filter(
    (row) =>
      !(
        row.status === 'HOLD' &&
        row.holdExpiresAt !== null &&
        row.holdExpiresAt.getTime() <= now.getTime()
      ),
  );
  if (visible.length === 0) return [];

  const customerIds = unique(
    visible.map((row) => row.customerId).filter((id): id is string => id !== null),
  );
  const serviceIds = unique(visible.map((row) => row.serviceId));
  const staffIds = unique(visible.map((row) => row.staffId));

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
  const staff =
    staffIds.length > 0
      ? await tx.staffProfile.findMany({
          where: { tenantId, id: { in: staffIds } },
          select: { id: true, tenantMember: { select: { user: { select: { name: true } } } } },
        })
      : [];
  const payments = await tx.payment.findMany({
    where: { tenantId, bookingId: { in: visible.map((row) => row.id) } },
    select: { bookingId: true, status: true },
  });

  const customerName = new Map(customers.map((row) => [row.id, row.user.name]));
  const serviceName = new Map(services.map((row) => [row.id, row.name]));
  const staffName = new Map(
    staff.map((row) => [row.id, row.tenantMember.user.name]),
  );

  const paymentStatus = new Map<string, 'PAID' | 'PENDING'>();
  for (const payment of payments) {
    const current = paymentStatus.get(payment.bookingId);
    if (payment.status === 'PAID' || current === undefined) {
      paymentStatus.set(payment.bookingId, payment.status === 'PAID' ? 'PAID' : 'PENDING');
    }
  }

  return visible.map((row) => {
    const paid = paymentStatus.get(row.id) === 'PAID';
    return {
      id: row.id,
      status: row.status,
      displayStatus: bookingDisplayStatus(row.status, paid),
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      staffId: row.staffId,
      staffName: staffName.get(row.staffId) ?? 'Profissional',
      customerName: row.customerId ? customerName.get(row.customerId) ?? 'Cliente' : 'Cliente',
      serviceName: serviceName.get(row.serviceId) ?? 'Serviço',
      priceCents: row.priceCents,
      source: row.source,
      completedAt: row.completedAt?.toISOString() ?? null,
      noShowAt: row.noShowAt?.toISOString() ?? null,
      paymentStatus: paymentStatus.get(row.id) ?? null,
    };
  });
}

/** `StaffProfile.id` do próprio usuário, quando existe. */
export async function getOwnStaffId(
  tx: TenantTransaction,
  tenantId: string,
  memberId: string,
): Promise<string | null> {
  const profile = await tx.staffProfile.findFirst({
    where: { tenantId, tenantMemberId: memberId },
    select: { id: true },
  });
  return profile?.id ?? null;
}

/**
 * Resolve o escopo de visão do usuário autenticado.
 *
 * Devolve `null` quando o pedido não pode ser atendido — profissional de outro
 * tenant, colega pedido por um STAFF, ou STAFF sem `StaffProfile`. Em todos os
 * casos a resposta é "não existe aqui", nunca "sem permissão": um 403 revelaria
 * que o id existe. A página traduz `null` em `notFound()`.
 */
export async function resolveAgendaScope(
  tx: TenantTransaction,
  tenantId: string,
  role: MemberRole,
  memberId: string,
  requestedStaffId: string | null,
): Promise<AgendaScope | null> {
  if (role === 'OWNER') {
    if (requestedStaffId) {
      const exists = await tx.staffProfile.findFirst({
        where: { tenantId, id: requestedStaffId },
        select: { id: true },
      });
      if (!exists) return null;
    }
    return { role, ownStaffId: null, filterStaffId: requestedStaffId };
  }

  // STAFF (e qualquer papel que não seja OWNER) enxerga apenas a si mesmo.
  const ownStaffId = await getOwnStaffId(tx, tenantId, memberId);
  if (!ownStaffId) return null;
  if (requestedStaffId && requestedStaffId !== ownStaffId) return null;
  return { role, ownStaffId, filterStaffId: ownStaffId };
}

function notFound(message = 'Agendamento não encontrado.'): AgendaFailure {
  return { ok: false, code: 'NOT_FOUND', message };
}

export interface StampOptions {
  now?: Date;
  /**
   * Quando informado (STAFF), só o agendamento deste profissional pode ser
   * carimbado. Um id de colega devolve `NOT_FOUND` — não vaza existência.
   */
  allowedStaffId?: string | null;
}

/** Marca o atendimento como FINALIZADO, carimbando `completedAt`. */
export async function markBookingCompleted(
  tx: TenantTransaction,
  tenantId: string,
  bookingId: string,
  options: StampOptions = {},
): Promise<BookingStampResult> {
  const now = options.now ?? new Date();

  const booking = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true, status: true, staffId: true },
  });
  if (!booking) return notFound();
  if (options.allowedStaffId && booking.staffId !== options.allowedStaffId) return notFound();

  if (booking.status === 'COMPLETED') return { ok: true };
  if (booking.status !== 'CONFIRMED') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: 'Só um atendimento confirmado pode ser finalizado.',
    };
  }

  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'COMPLETED', completedAt: now },
  });
  return { ok: true };
}

/** Marca o atendimento como NÃO COMPARECEU, carimbando `noShowAt`. */
export async function markBookingNoShow(
  tx: TenantTransaction,
  tenantId: string,
  bookingId: string,
  options: StampOptions = {},
): Promise<BookingStampResult> {
  const now = options.now ?? new Date();

  const booking = await tx.booking.findFirst({
    where: { id: bookingId, tenantId },
    select: { id: true, status: true, staffId: true },
  });
  if (!booking) return notFound();
  if (options.allowedStaffId && booking.staffId !== options.allowedStaffId) return notFound();

  if (booking.status === 'NO_SHOW') return { ok: true };
  if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: 'Só um atendimento confirmado ou pendente pode ser marcado como não compareceu.',
    };
  }

  await tx.booking.update({
    where: { id: booking.id },
    data: { status: 'NO_SHOW', noShowAt: now },
  });
  return { ok: true };
}

export interface CreateWalkInInput {
  tenantId: string;
  staffId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  /** Instante UTC do início. */
  startsAt: Date;
  now?: Date;
}

/**
 * Localiza/cria o cliente do walk-in pelo telefone. Quem já é membro do tenant
 * (em qualquer papel) é preservado — não rebaixamos um colega a CUSTOMER; quem
 * nunca apareceu nasce CUSTOMER, como no primeiro acesso do portal.
 */
async function resolveWalkInCustomer(
  tx: TenantTransaction,
  tenantId: string,
  name: string,
  phone: string,
): Promise<string> {
  const existingUser = await tx.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  const userId =
    existingUser?.id ??
    (await tx.user.create({ data: { phone, name }, select: { id: true } })).id;

  const existingMember = await tx.tenantMember.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { id: true },
  });
  if (existingMember) return existingMember.id;

  const created = await tx.tenantMember.create({
    data: { tenantId, userId, role: 'CUSTOMER' },
    select: { id: true },
  });
  return created.id;
}

/**
 * Cria o walk-in: cliente resolvido, hold com `source='WALK_IN'` e confirmação.
 * A antecedência mínima é ignorada; o anti-overlap continua sendo o banco.
 */
export async function createWalkIn(input: CreateWalkInInput): Promise<WalkInResult> {
  const now = input.now ?? new Date();

  const prepared = await forTenant(input.tenantId, async (tx) => {
    const staff = await tx.staffProfile.findFirst({
      where: { tenantId: input.tenantId, id: input.staffId },
      select: { id: true },
    });
    if (!staff) {
      return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Profissional não encontrado.' };
    }

    const service = await tx.service.findFirst({
      where: { tenantId: input.tenantId, id: input.serviceId, active: true },
      select: { id: true },
    });
    if (!service) {
      return {
        ok: false as const,
        code: 'NOT_FOUND' as const,
        message: 'Serviço não encontrado ou inativo.',
      };
    }

    const customerId = await resolveWalkInCustomer(
      tx,
      input.tenantId,
      input.customerName,
      input.customerPhone,
    );
    return { ok: true as const, customerId };
  });

  if (!prepared.ok) return prepared;

  let hold;
  try {
    hold = await createHold({
      tenantId: input.tenantId,
      customerId: prepared.customerId,
      staffId: input.staffId,
      serviceId: input.serviceId,
      startsAt: input.startsAt,
      // Dono do hold de balcão. É o que impede que a limpeza automática trate o
      // walk-in como hold de portal abandonado antes da confirmação.
      holdSessionId: `walk-in:${input.staffId}`,
      source: 'WALK_IN',
      now,
    });
  } catch (error) {
    if (isSlotUnavailableError(error)) {
      return {
        ok: false,
        code: 'SLOT_UNAVAILABLE',
        message: 'Já existe um atendimento nesse horário para este profissional.',
      };
    }
    if (error instanceof HoldError && error.code === 'SERVICE_NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Serviço não encontrado ou inativo.' };
    }
    throw error;
  }

  try {
    await confirmBooking({
      tenantId: input.tenantId,
      bookingId: hold.id,
      customerId: prepared.customerId,
      now,
    });
  } catch (error) {
    if (error instanceof ConfirmBookingError) {
      return { ok: false, code: 'INVALID_STATE', message: error.message };
    }
    throw error;
  }

  const [booking] = await forTenant(input.tenantId, (tx) =>
    loadAgendaBookings(tx, input.tenantId, {
      staffId: input.staffId,
      start: input.startsAt,
      end: new Date(input.startsAt.getTime() + 1),
      now,
    }),
  );
  if (!booking) {
    return { ok: false, code: 'NOT_FOUND', message: 'Walk-in criado, mas não foi possível recarregá-lo.' };
  }
  return { ok: true, booking };
}
