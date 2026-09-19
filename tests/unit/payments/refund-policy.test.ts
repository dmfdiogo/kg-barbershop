import { describe, expect, it } from 'vitest';
import { resolveRefundCap } from '@/lib/payments/refund';

/**
 * Política de estorno do tenant (F4.3), testada sem banco nem provedor: é função
 * pura de propósito, para que a regra "quem cancela dentro da janela tem
 * estorno" seja auditável e não fique enterrada no meio de queries.
 */

const STARTS_AT = new Date('2027-06-01T12:00:00.000Z');

function hoursBefore(hours: number): Date {
  return new Date(STARTS_AT.getTime() - hours * 3_600_000);
}

describe('resolveRefundCap', () => {
  it('libera o saldo estornável quando cancela com antecedência suficiente', () => {
    const cap = resolveRefundCap({
      remainingCents: 5000,
      bookingStatus: 'CANCELLED',
      startsAt: STARTS_AT,
      cancelledAt: hoursBefore(48),
      cancellationWindowHours: 24,
    });

    expect(cap).toMatchObject({ policy: 'ELIGIBLE', maxRefundableCents: 5000 });
  });

  it('libera exatamente na borda da janela', () => {
    const cap = resolveRefundCap({
      remainingCents: 5000,
      bookingStatus: 'CANCELLED',
      startsAt: STARTS_AT,
      cancelledAt: hoursBefore(24),
      cancellationWindowHours: 24,
    });

    expect(cap).toMatchObject({ policy: 'ELIGIBLE', maxRefundableCents: 5000 });
  });

  it('bloqueia cancelamento dentro da janela', () => {
    const cap = resolveRefundCap({
      remainingCents: 5000,
      bookingStatus: 'CANCELLED',
      startsAt: STARTS_AT,
      cancelledAt: hoursBefore(1),
      cancellationWindowHours: 24,
    });

    expect(cap).toMatchObject({ policy: 'LATE_CANCELLATION', maxRefundableCents: 0 });
  });

  it('bloqueia agendamento que não foi cancelado', () => {
    const cap = resolveRefundCap({
      remainingCents: 5000,
      bookingStatus: 'CONFIRMED',
      startsAt: STARTS_AT,
      cancelledAt: null,
      cancellationWindowHours: 24,
    });

    expect(cap).toMatchObject({ policy: 'NOT_CANCELLED', maxRefundableCents: 0 });
  });

  it('não libera nada quando já estornou por inteiro', () => {
    const cap = resolveRefundCap({
      remainingCents: 0,
      bookingStatus: 'CANCELLED',
      startsAt: STARTS_AT,
      cancelledAt: hoursBefore(48),
      cancellationWindowHours: 24,
    });

    expect(cap).toMatchObject({ policy: 'NOTHING_TO_REFUND', maxRefundableCents: 0 });
  });

  it('com janela zero, qualquer cancelamento anterior libera', () => {
    const cap = resolveRefundCap({
      remainingCents: 3000,
      bookingStatus: 'CANCELLED',
      startsAt: STARTS_AT,
      cancelledAt: hoursBefore(1),
      cancellationWindowHours: 0,
    });

    expect(cap).toMatchObject({ policy: 'ELIGIBLE', maxRefundableCents: 3000 });
  });
});
