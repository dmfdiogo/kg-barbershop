// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ConfirmBookingError,
  confirmBooking,
  emitBookingEvent,
  type BookingConfirmedEvent,
  type BookingEventHandler,
  type BookingParticipant,
} from '@/lib/booking/confirm';
import { createHold } from '@/lib/booking/hold';
import { forTenant, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Pontos de extensão da confirmação (item 3.1 da F3.2):
 * participantes de transação (reexecutáveis!) e eventos pós-commit.
 */

describe('pontos de extensão da confirmação', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'confirm');
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin) await admin.disconnect();
  });

  let slotSeed = 0;

  async function newHold(session: string): Promise<string> {
    slotSeed += 1;
    const startsAt = new Date(Date.UTC(2026, 11, 10 + slotSeed, 13, 0, 0));
    const hold = await createHold({
      tenantId: fixture.tenantId,
      customerId: fixture.customerMemberId,
      staffId: fixture.staffId,
      serviceId: fixture.serviceId,
      startsAt,
      holdSessionId: session,
    });
    return hold.id;
  }

  async function statusOf(bookingId: string): Promise<string | null> {
    const booking = await forTenant(fixture.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: bookingId }, select: { status: true } }),
    );
    return booking?.status ?? null;
  }

  it('roda o participante dentro da transação, enxergando o agendamento já CONFIRMED', async () => {
    const bookingId = await newHold('participant-in-tx');
    const seenStatuses: string[] = [];

    const participant: BookingParticipant = async (tx, context) => {
      const row = await tx.booking.findUnique({
        where: { id: context.bookingId },
        select: { status: true },
      });
      seenStatuses.push(row?.status ?? 'missing');
      // Efeito atômico de exemplo: uma linha de auditoria na MESMA transação.
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorId: null,
          action: 'booking.confirmed',
          entity: 'Booking',
          entityId: context.bookingId,
        },
      });
    };

    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      participants: [participant],
      handlers: [],
    });

    expect(result.booking.status).toBe('CONFIRMED');
    expect(result.previousStatus).toBe('HOLD');
    expect(seenStatuses).toEqual(['CONFIRMED']);

    const logs = await forTenant(fixture.tenantId, (tx) =>
      tx.auditLog.count({ where: { entityId: bookingId, action: 'booking.confirmed' } }),
    );
    expect(logs).toBe(1);
  });

  it('participante que lança aborta a confirmação inteira (rollback)', async () => {
    const bookingId = await newHold('participant-throws');

    const participant: BookingParticipant = async (tx, context) => {
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorId: null,
          action: 'booking.would_be_lost',
          entity: 'Booking',
          entityId: context.bookingId,
        },
      });
      throw new Error('boom');
    };

    await expect(
      confirmBooking({
        tenantId: fixture.tenantId,
        bookingId,
        participants: [participant],
        handlers: [],
      }),
    ).rejects.toThrow('boom');

    expect(await statusOf(bookingId)).toBe('HOLD');
    const logs = await forTenant(fixture.tenantId, (tx) =>
      tx.auditLog.count({ where: { entityId: bookingId, action: 'booking.would_be_lost' } }),
    );
    expect(logs).toBe(0);
  });

  it('reexecuta o participante sem duplicar efeito quando a transação sofre retry (P2034)', async () => {
    const bookingId = await newHold('participant-retry');
    let calls = 0;

    const participant: BookingParticipant = async (tx, context) => {
      calls += 1;
      await tx.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorId: null,
          action: 'trial.counted',
          entity: 'Booking',
          entityId: context.bookingId,
        },
      });
      if (calls === 1) {
        // Simula o write conflict sob disputa de slot: o client escopado
        // reexecuta a transação inteira (lib/tenant/retry.ts).
        throw Object.assign(new Error('simulated serialization failure'), { code: 'P2034' });
      }
    };

    await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      participants: [participant],
      handlers: [],
    });

    expect(calls).toBe(2);
    expect(await statusOf(bookingId)).toBe('CONFIRMED');
    // Uma linha só: a primeira tentativa foi desfeita pelo rollback do retry.
    const logs = await forTenant(fixture.tenantId, (tx) =>
      tx.auditLog.count({ where: { entityId: bookingId, action: 'trial.counted' } }),
    );
    expect(logs).toBe(1);
  });

  it('emite BookingConfirmed pós-commit, isola falha de handler e não desfaz o agendamento', async () => {
    const bookingId = await newHold('event-post-commit');
    const observed: string[] = [];

    const failingHandler: BookingEventHandler<BookingConfirmedEvent> = async () => {
      throw new Error('whatsapp fora do ar');
    };
    const observingHandler: BookingEventHandler<BookingConfirmedEvent> = async (event) => {
      observed.push(`event:${event.type}`);
      // Transação NOVA: se o handler enxerga CONFIRMED, o commit já aconteceu.
      const booking = await forTenant(event.tenantId, (tx) =>
        tx.booking.findUnique({ where: { id: event.bookingId }, select: { status: true } }),
      );
      observed.push(`db:${booking?.status ?? 'missing'}`);
    };

    const result = await confirmBooking({
      tenantId: fixture.tenantId,
      bookingId,
      participants: [],
      handlers: [failingHandler, observingHandler],
    });

    expect(result.booking.status).toBe('CONFIRMED');
    expect(observed).toEqual(['event:BookingConfirmed', 'db:CONFIRMED']);
    expect(await statusOf(bookingId)).toBe('CONFIRMED');
  });

  it('emite BookingCancelled e BookingRescheduled e nunca propaga falha do handler', async () => {
    const received: string[] = [];
    const handler: BookingEventHandler = (event) => {
      received.push(event.type);
    };

    await emitBookingEvent(
      {
        type: 'BookingCancelled',
        tenantId: fixture.tenantId,
        bookingId: 'booking-x',
        occurredAt: new Date(),
        customerId: fixture.customerMemberId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        startsAt: new Date(),
        endsAt: new Date(),
        cancelledBy: null,
        reason: null,
      },
      [handler],
    );
    await emitBookingEvent(
      {
        type: 'BookingRescheduled',
        tenantId: fixture.tenantId,
        bookingId: 'booking-x',
        occurredAt: new Date(),
        customerId: fixture.customerMemberId,
        serviceId: fixture.serviceId,
        previousStaffId: fixture.staffId,
        previousStartsAt: new Date(),
        previousEndsAt: new Date(),
        staffId: fixture.staffId,
        startsAt: new Date(),
        endsAt: new Date(),
      },
      [handler],
    );

    expect(received).toEqual(['BookingCancelled', 'BookingRescheduled']);

    await expect(
      emitBookingEvent(
        {
          type: 'BookingConfirmed',
          tenantId: fixture.tenantId,
          bookingId: 'booking-x',
          occurredAt: new Date(),
          customerId: fixture.customerMemberId,
          staffId: fixture.staffId,
          serviceId: fixture.serviceId,
          startsAt: new Date(),
          endsAt: new Date(),
          priceCents: 5000,
          previousStatus: 'HOLD',
        },
        [
          () => {
            throw new Error('handler quebrado');
          },
        ],
      ),
    ).resolves.toBeUndefined();
  });

  it('recusa confirmação de agendamento inexistente ou fora de HOLD/PENDING', async () => {
    await expect(
      confirmBooking({ tenantId: fixture.tenantId, bookingId: 'nao-existe', handlers: [] }),
    ).rejects.toBeInstanceOf(ConfirmBookingError);

    const bookingId = await newHold('invalid-state');
    await admin.asPlatformAdmin((tx) =>
      tx.booking.update({ where: { id: bookingId }, data: { status: 'CANCELLED' } }),
    );

    await expect(
      confirmBooking({ tenantId: fixture.tenantId, bookingId, handlers: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
