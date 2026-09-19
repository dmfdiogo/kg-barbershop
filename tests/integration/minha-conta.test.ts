// @vitest-environment node
import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { TenantContext } from '@/lib/tenant/context';
import { resolveTenantById, toTenantContext } from '@/lib/tenant/context';
import { getTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createHold } from '@/lib/booking/hold';
import { confirmBooking } from '@/lib/booking/confirm';
import {
  CancelBookingError,
  cancelBooking,
  cancellationDeadline,
} from '@/lib/booking/cancel';
import { rescheduleBooking } from '@/lib/booking/reschedule';
import { SlotUnavailableError } from '@/lib/tenant/errors';
import {
  buildSlotOptions,
  dayOfInstant,
  loadDayState,
} from '@/app/[slug]/(portal)/agendar/_lib/availability';
import { rescheduleCustomerBooking } from '@/app/[slug]/(portal)/minha-conta/_lib/account-flow';
import {
  createAdminDb,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
} from './helpers/test-database';

/**
 * Área do cliente (F3.4) contra Postgres real.
 *
 * O que se prova aqui é o que a tarefa exige e o que uma UI bonita esconde:
 *   - cancelar DENTRO da janela libera o horário de verdade (a linha sai da
 *     exclusion constraint) e emite `BookingCancelled` pós-commit;
 *   - cancelar FORA da janela falha e não mexe no agendamento;
 *   - remarcar é atômico: ou o antigo é liberado e o novo nasce CONFIRMED, ou
 *     nada muda (slot tomado por terceiro aborta a transação inteira);
 *   - um cliente não cancela/remarca agendamento de outro cliente nem de outro
 *     tenant.
 */

const TZ = 'America/Sao_Paulo';
const TARGET_DATE = '2026-12-15';
const NOW = fromZonedTime(`${TARGET_DATE}T08:00:00`, TZ);

interface TenantFixture {
  tenantId: string;
  slug: string;
  staffId: string;
  serviceId: string;
  customerId: string;
  otherCustomerId: string;
}

function phone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

function wallClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

function slotAt(hhmm: string): Date {
  return fromZonedTime(`${TARGET_DATE}T${hhmm}:00`, TZ);
}

async function createFixture(admin: TenantDb, prefix: string): Promise<TenantFixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
  const slug = `${prefix}-${suffix}`;
  const weekday = toZonedTime(fromZonedTime(`${TARGET_DATE}T00:00:00`, TZ), TZ).getDay();

  return admin.asPlatformAdmin(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        slug,
        name: `Tenant ${suffix}`,
        document: '12345678901',
        timezone: TZ,
        status: 'ACTIVE',
        cancellationWindowHours: 1,
      },
    });

    const staffUser = await tx.user.create({ data: { phone: phone(), name: 'Profissional' } });
    const staffMember = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' },
    });
    const profile = await tx.staffProfile.create({
      data: { tenantId: tenant.id, tenantMemberId: staffMember.id },
    });
    await tx.workingHours.create({
      data: {
        tenantId: tenant.id,
        staffId: profile.id,
        weekday,
        startTime: wallClock('09:00'),
        endTime: wallClock('18:00'),
      },
    });

    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        name: 'Corte',
        durationMin: 30,
        bufferMin: 10,
        priceCents: 5000,
        paymentMode: 'ON_SITE',
      },
    });
    await tx.staffService.create({
      data: { tenantId: tenant.id, staffId: profile.id, serviceId: service.id },
    });

    const customerUser = await tx.user.create({ data: { phone: phone(), name: 'Cliente' } });
    const customer = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: customerUser.id, role: 'CUSTOMER' },
    });

    const otherUser = await tx.user.create({ data: { phone: phone(), name: 'Outro cliente' } });
    const other = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: otherUser.id, role: 'CUSTOMER' },
    });

    return {
      tenantId: tenant.id,
      slug,
      staffId: profile.id,
      serviceId: service.id,
      customerId: customer.id,
      otherCustomerId: other.id,
    };
  });
}

async function contextFor(tenantId: string): Promise<TenantContext> {
  const lookup = await resolveTenantById(tenantId);
  if (!lookup.ok) throw new Error('Fixture tenant não resolveu.');
  return toTenantContext(lookup);
}

describe('área do cliente: cancelar e remarcar', () => {
  let admin: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ctxA: TenantContext;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    await ensureTestDatabase();
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = rlsDatabaseUrl();
    admin = createAdminDb();
    tenantA = await createFixture(admin, 'conta-a');
    tenantB = await createFixture(admin, 'conta-b');
    ctxA = await contextFor(tenantA.tenantId);
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.tenantId);
      if (tenantB) await deleteTenant(admin, tenantB.tenantId);
      await admin.disconnect();
    }
    getTenantDb().disconnect();
    if (originalDatabaseUrl) process.env.DATABASE_URL = originalDatabaseUrl;
  });

  async function setWindow(tenantId: string, hours: number): Promise<void> {
    await admin.asPlatformAdmin((tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { cancellationWindowHours: hours } }),
    );
  }

  /** Cria um agendamento CONFIRMED pelo caminho real (hold → confirmação). */
  async function book(
    fixture: TenantFixture,
    hhmm: string,
    customerId: string = fixture.customerId,
  ) {
    const startsAt = slotAt(hhmm);
    const hold = await createHold({
      tenantId: fixture.tenantId,
      customerId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      startsAt,
      holdSessionId: `seed-${hhmm}-${customerId}`,
      now: NOW,
    });
    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId: hold.id,
      customerId,
      handlers: [],
      now: NOW,
    });
    return result.booking;
  }

  async function availableSlots(ctx: TenantContext, fixture: TenantFixture): Promise<string[]> {
    const loaded = await loadDayState(ctx, fixture.serviceId, fixture.staffId, TARGET_DATE);
    if (!loaded) throw new Error('Dia não carregou.');
    return buildSlotOptions(loaded, NOW).map((slot) => slot.value);
  }

  async function statusOf(ctx: TenantContext, bookingId: string): Promise<string | null> {
    const booking = await ctx.forTenant((tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } }),
    );
    return booking?.status ?? null;
  }

  it('cancelar dentro da janela devolve o horário à grade e emite BookingCancelled', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '09:00');

    expect(await availableSlots(ctxA, tenantA)).not.toContain(slotAt('09:00').toISOString());

    const events: string[] = [];
    const seenStatuses: string[] = [];

    const result = await cancelBooking({
      tenantId: tenantA.tenantId,
      bookingId: booking.id,
      customerId: tenantA.customerId,
      cancelledBy: 'user-que-cancelou',
      reason: 'Cliente desmarcou',
      now: NOW,
      handlers: [
        async (event) => {
          events.push(event.type);
          // Transação NOVA: se enxerga CANCELLED, o commit já aconteceu.
          const status = await ctxA.forTenant((tx) =>
            tx.booking.findUnique({ where: { id: event.bookingId }, select: { status: true } }),
          );
          seenStatuses.push(status?.status ?? 'missing');
        },
      ],
    });

    expect(result.alreadyCancelled).toBe(false);
    expect(await statusOf(ctxA, booking.id)).toBe('CANCELLED');
    expect(await availableSlots(ctxA, tenantA)).toContain(slotAt('09:00').toISOString());

    const stored = await ctxA.forTenant((tx) =>
      tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { cancelledAt: true, cancelledBy: true, cancellationReason: true },
      }),
    );
    expect(stored.cancelledAt).not.toBeNull();
    expect(stored.cancelledBy).toBe('user-que-cancelou');
    expect(stored.cancellationReason).toBe('Cliente desmarcou');

    expect(events).toEqual(['BookingCancelled']);
    expect(seenStatuses).toEqual(['CANCELLED']);
  });

  it('cancelar fora da janela falha e mantém o agendamento intacto', async () => {
    await setWindow(tenantA.tenantId, 24);
    const booking = await book(tenantA, '10:00');

    await expect(
      cancelBooking({
        tenantId: tenantA.tenantId,
        bookingId: booking.id,
        customerId: tenantA.customerId,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLATION_WINDOW_CLOSED' });

    expect(await statusOf(ctxA, booking.id)).toBe('CONFIRMED');
    expect(await availableSlots(ctxA, tenantA)).not.toContain(slotAt('10:00').toISOString());

    // E o limite exposto para a UI é exatamente startsAt - janela.
    expect(cancellationDeadline(booking.startsAt, 24).getTime()).toBe(
      booking.startsAt.getTime() - 24 * 3_600_000,
    );
  });

  it('um cliente não cancela o agendamento de outro', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '11:00', tenantA.otherCustomerId);

    await expect(
      cancelBooking({
        tenantId: tenantA.tenantId,
        bookingId: booking.id,
        customerId: tenantA.customerId,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(CancelBookingError);

    expect(await statusOf(ctxA, booking.id)).toBe('CONFIRMED');
  });

  it('cancelamento é idempotente: a segunda chamada não reemite o evento', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '11:45');

    let emissions = 0;
    const handlers = [() => void (emissions += 1)];

    const first = await cancelBooking({
      tenantId: tenantA.tenantId,
      bookingId: booking.id,
      customerId: tenantA.customerId,
      now: NOW,
      handlers,
    });
    const second = await cancelBooking({
      tenantId: tenantA.tenantId,
      bookingId: booking.id,
      customerId: tenantA.customerId,
      now: NOW,
      handlers,
    });

    expect(first.alreadyCancelled).toBe(false);
    expect(second.alreadyCancelled).toBe(true);
    expect(emissions).toBe(1);
  });

  it('remarcar libera o antigo, confirma o novo e emite BookingRescheduled', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '13:00');
    const events: string[] = [];

    expect(await availableSlots(ctxA, tenantA)).not.toContain(slotAt('13:00').toISOString());

    const result = await rescheduleBooking({
      tenantId: tenantA.tenantId,
      bookingId: booking.id,
      customerId: tenantA.customerId,
      newStartsAt: slotAt('15:00'),
      holdSessionId: 'device-reschedule',
      now: NOW,
      handlers: [
        (event) => {
          events.push(event.type);
        },
      ],
    });

    expect(result.previous.status).toBe('CANCELLED');
    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.booking.startsAt.toISOString()).toBe(slotAt('15:00').toISOString());
    expect(result.previous.startsAt.toISOString()).toBe(slotAt('13:00').toISOString());

    const slots = await availableSlots(ctxA, tenantA);
    expect(slots).toContain(slotAt('13:00').toISOString());
    expect(slots).not.toContain(slotAt('15:00').toISOString());

    // Um único CONFIRMED no horário novo; o antigo não ficou preso.
    const newConfirmed = await ctxA.forTenant((tx) =>
      tx.booking.count({
        where: {
          tenantId: tenantA.tenantId,
          customerId: tenantA.customerId,
          startsAt: slotAt('15:00'),
          status: 'CONFIRMED',
        },
      }),
    );
    expect(newConfirmed).toBe(1);

    expect(events).toEqual(['BookingRescheduled']);
  });

  it('remarcar para horário tomado aborta a transação e preserva o agendamento antigo', async () => {
    await setWindow(tenantA.tenantId, 1);
    const mine = await book(tenantA, '16:00');
    await book(tenantA, '16:45', tenantA.otherCustomerId);

    await expect(
      rescheduleBooking({
        tenantId: tenantA.tenantId,
        bookingId: mine.id,
        customerId: tenantA.customerId,
        newStartsAt: slotAt('16:45'),
        holdSessionId: 'device-conflict',
        now: NOW,
        handlers: [],
      }),
    ).rejects.toBeInstanceOf(SlotUnavailableError);

    // Rollback: o antigo continua CONFIRMED e nenhum novo agendamento nasceu.
    expect(await statusOf(ctxA, mine.id)).toBe('CONFIRMED');
    const nasceu = await ctxA.forTenant((tx) =>
      tx.booking.count({
        where: {
          tenantId: tenantA.tenantId,
          customerId: tenantA.customerId,
          startsAt: slotAt('16:45'),
        },
      }),
    );
    expect(nasceu).toBe(0);
  });

  it('a orquestração recusa remarcar para um horário que a grade não oferta', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '09:15');

    const result = await rescheduleCustomerBooking({
      ctx: ctxA,
      memberId: tenantA.customerId,
      bookingId: booking.id,
      startsAt: fromZonedTime(`${TARGET_DATE}T03:00:00`, TZ),
      holdSessionId: 'device-off-grid',
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, code: 'SLOT_UNAVAILABLE' });
    expect(await statusOf(ctxA, booking.id)).toBe('CONFIRMED');
  });

  it('o tenant B não enxerga, cancela nem remarca agendamento do tenant A', async () => {
    await setWindow(tenantA.tenantId, 1);
    const booking = await book(tenantA, '12:15');

    await expect(
      cancelBooking({
        tenantId: tenantB.tenantId,
        bookingId: booking.id,
        customerId: tenantB.customerId,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    await expect(
      rescheduleBooking({
        tenantId: tenantB.tenantId,
        bookingId: booking.id,
        customerId: tenantB.customerId,
        newStartsAt: slotAt('12:45'),
        holdSessionId: 'device-cross',
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_FOUND' });

    expect(await statusOf(ctxA, booking.id)).toBe('CONFIRMED');
  });

  it('a grade identifica o dia da remarcação no fuso do tenant', () => {
    const late = fromZonedTime(`${TARGET_DATE}T21:00:00`, TZ);
    expect(dayOfInstant(late, TZ)).toBe(TARGET_DATE);
  });
});
