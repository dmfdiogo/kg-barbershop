// @vitest-environment node
import type { BookingStatus, PaymentStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  PERMITTED_BOOKING_TRANSITIONS,
  PERMITTED_PAYMENT_TRANSITIONS,
  PROHIBITED_PAYMENT_TRANSITIONS,
  PaymentWebhookValidationError,
  canTransitionPayment,
  planPaymentTransition,
  resolveBookingConfirmation,
  resolveBookingRelease,
  type LocalPaymentState,
} from '@/lib/payments/state';
import type {
  PaymentWebhookChargeData,
  PaymentWebhookEventType,
} from '@/lib/payments/webhook';

const ALL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

const ALL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'HOLD',
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
];

function local(overrides: Partial<LocalPaymentState> = {}): LocalPaymentState {
  return {
    status: 'PENDING',
    amountCents: 5000,
    paidAt: null,
    asaasId: 'chg_mock_1',
    ...overrides,
  };
}

interface ChargeOverrides {
  amountCents?: number;
  refundedCents?: number;
  paidAt?: string;
}

function charge(overrides: ChargeOverrides = {}): PaymentWebhookChargeData {
  return {
    id: 'chg_mock_1',
    accountId: 'acc_mock_1',
    status: 'PAID',
    amountCents: 5000,
    refundedCents: 0,
    ...overrides,
  };
}

function event(type: PaymentWebhookEventType, overrides: ChargeOverrides = {}) {
  return {
    type,
    occurredAt: '2026-11-03T13:00:00.000Z',
    charge: charge(overrides),
  };
}

describe('tabelas de transição', () => {
  it('as permitidas não incluem estados terminais como origem', () => {
    expect(PERMITTED_PAYMENT_TRANSITIONS.FAILED).toEqual([]);
    expect(PERMITTED_PAYMENT_TRANSITIONS.EXPIRED).toEqual([]);
    expect(PERMITTED_PAYMENT_TRANSITIONS.REFUNDED).toEqual([]);
  });

  it('proibidas = todo par ordenado fora das permitidas', () => {
    for (const from of ALL_PAYMENT_STATUSES) {
      for (const to of ALL_PAYMENT_STATUSES) {
        if (from === to) continue;
        const permitted = canTransitionPayment(from, to);
        const listed = PROHIBITED_PAYMENT_TRANSITIONS.some(
          (pair) => pair.from === from && pair.to === to,
        );
        expect(listed).toBe(!permitted);
      }
    }
  });

  it('não permite voltar de estorno para pago', () => {
    expect(canTransitionPayment('REFUNDED', 'PAID')).toBe(false);
    expect(canTransitionPayment('PARTIALLY_REFUNDED', 'PAID')).toBe(false);
  });

  it('transições de Booking são explícitas', () => {
    for (const status of ALL_BOOKING_STATUSES) {
      expect(PERMITTED_BOOKING_TRANSITIONS[status]).toBeDefined();
    }
    expect(PERMITTED_BOOKING_TRANSITIONS.COMPLETED).toEqual([]);
  });
});

describe('planPaymentTransition (pago, recusado, expirado)', () => {
  it('pagamento aprovado aplica PAID e confirma o agendamento', () => {
    const plan = planPaymentTransition(local(), event('CHARGE_PAID'));

    expect(plan).toMatchObject({ kind: 'applied', status: 'PAID', bookingEffect: 'confirm' });
  });

  it('recusa aplica FAILED e libera o agendamento', () => {
    const plan = planPaymentTransition(local(), event('CHARGE_REFUSED'));

    expect(plan).toMatchObject({ kind: 'applied', status: 'FAILED', bookingEffect: 'release' });
  });

  it('Pix expirado aplica EXPIRED e libera o agendamento', () => {
    const plan = planPaymentTransition(local(), event('CHARGE_EXPIRED'));

    expect(plan).toMatchObject({ kind: 'applied', status: 'EXPIRED', bookingEffect: 'release' });
  });
});

describe('planPaymentTransition (estornos)', () => {
  it('estorno total exige refundedCents = amount e aplica REFUNDED', () => {
    const plan = planPaymentTransition(
      local({ status: 'PAID', paidAt: new Date() }),
      event('CHARGE_REFUNDED', { refundedCents: 5000 }),
    );

    expect(plan).toMatchObject({ kind: 'applied', status: 'REFUNDED', bookingEffect: 'none' });
  });

  it('estorno parcial exige 0 < refundedCents < amount e aplica PARTIALLY_REFUNDED', () => {
    const plan = planPaymentTransition(
      local({ status: 'PAID', paidAt: new Date() }),
      event('CHARGE_PARTIALLY_REFUNDED', { refundedCents: 2000 }),
    );

    expect(plan).toMatchObject({
      kind: 'applied',
      status: 'PARTIALLY_REFUNDED',
      bookingEffect: 'none',
    });
  });

  it('parcial depois de parcial e total depois de parcial são permitidos', () => {
    const second = planPaymentTransition(
      local({ status: 'PARTIALLY_REFUNDED', paidAt: new Date() }),
      event('CHARGE_PARTIALLY_REFUNDED', { refundedCents: 3000 }),
    );
    expect(second).toMatchObject({ kind: 'applied', status: 'PARTIALLY_REFUNDED' });

    const total = planPaymentTransition(
      local({ status: 'PARTIALLY_REFUNDED', paidAt: new Date() }),
      event('CHARGE_REFUNDED', { refundedCents: 5000 }),
    );
    expect(total).toMatchObject({ kind: 'applied', status: 'REFUNDED' });
  });
});

describe('evento fora de ordem', () => {
  it('estorno total chegando quando o local ainda é PENDING vale (estado final venceu)', () => {
    const plan = planPaymentTransition(local(), event('CHARGE_REFUNDED', { refundedCents: 5000 }));

    expect(plan).toMatchObject({ kind: 'applied', status: 'REFUNDED', bookingEffect: 'none' });
  });

  it('confirmação chegando DEPOIS do estorno é ignorada e não regride', () => {
    const plan = planPaymentTransition(
      local({ status: 'REFUNDED', paidAt: new Date() }),
      event('CHARGE_PAID'),
    );

    expect(plan).toMatchObject({ kind: 'ignored', reason: 'terminal', incoming: 'PAID' });
  });

  it('expiração chegando depois do pagamento é ignorada', () => {
    const plan = planPaymentTransition(local({ status: 'PAID' }), event('CHARGE_EXPIRED'));

    expect(plan).toMatchObject({ kind: 'ignored', reason: 'stale', incoming: 'EXPIRED' });
  });

  it('reentrega do mesmo estado é already-applied (não reprocessa)', () => {
    const plan = planPaymentTransition(local({ status: 'PAID' }), event('CHARGE_PAID'));

    expect(plan).toMatchObject({ kind: 'already-applied', status: 'PAID' });
  });
});

describe('payload é entrada não confiável', () => {
  it('valor divergente do registro local é recusado', () => {
    expect(() =>
      planPaymentTransition(local(), event('CHARGE_PAID', { amountCents: 4999 })),
    ).toThrow(PaymentWebhookValidationError);
  });

  it('estorno total com refundedCents menor que o valor é recusado', () => {
    expect(() =>
      planPaymentTransition(
        local({ status: 'PAID' }),
        event('CHARGE_REFUNDED', { refundedCents: 4000 }),
      ),
    ).toThrow(PaymentWebhookValidationError);
  });

  it('estorno parcial com refundedCents igual ao valor é recusado', () => {
    expect(() =>
      planPaymentTransition(
        local({ status: 'PAID' }),
        event('CHARGE_PARTIALLY_REFUNDED', { refundedCents: 5000 }),
      ),
    ).toThrow(PaymentWebhookValidationError);
  });

  it('evento de recusa com valor estornado é recusado', () => {
    expect(() =>
      planPaymentTransition(local(), event('CHARGE_REFUSED', { refundedCents: 100 })),
    ).toThrow(PaymentWebhookValidationError);
  });
});

describe('resolução de efeito no Booking', () => {
  it('confirma a partir de HOLD e PENDING', () => {
    expect(resolveBookingConfirmation('HOLD').kind).toBe('confirmed');
    expect(resolveBookingConfirmation('PENDING').kind).toBe('confirmed');
  });

  it('confirmar um agendamento já confirmado é already-applied', () => {
    expect(resolveBookingConfirmation('CONFIRMED')).toEqual({
      kind: 'already-applied',
      status: 'CONFIRMED',
    });
  });

  it('não reabre um agendamento cancelado', () => {
    expect(resolveBookingConfirmation('CANCELLED').kind).toBe('ignored');
  });

  it('libera a partir de HOLD e PENDING, sem tocar em CONFIRMED', () => {
    expect(resolveBookingRelease('HOLD').kind).toBe('cancelled');
    expect(resolveBookingRelease('PENDING').kind).toBe('cancelled');
    expect(resolveBookingRelease('CONFIRMED').kind).toBe('ignored');
  });
});
