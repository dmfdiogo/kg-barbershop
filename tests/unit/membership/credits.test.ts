import { describe, expect, it } from 'vitest';
import {
  CREDIT_REASON,
  InsufficientCreditError,
  resolveCreditBookingDecision,
  type CreditCoverage,
} from '@/lib/membership/credits';

/**
 * Regras puras do clube de créditos (F5.2). A parte que toca banco vive no
 * teste de integração `tests/integration/membership/credits.test.ts`.
 */

function coverage(overrides: Partial<CreditCoverage> = {}): CreditCoverage {
  return {
    membershipId: 'membership-1',
    planId: 'plan-1',
    serviceId: 'service-1',
    quantityPerCycle: 2,
    balance: 1,
    ...overrides,
  };
}

describe('decisão de cobertura por crédito', () => {
  it('sem clube ativo ou sem benefício para o serviço, não usa crédito', () => {
    expect(resolveCreditBookingDecision(null, false)).toEqual({
      membershipId: null,
      useCredit: false,
      requiresDeposit: false,
      balance: 0,
    });
  });

  it('saldo zerado não usa crédito, mesmo com benefício', () => {
    expect(resolveCreditBookingDecision(coverage({ balance: 0 }), false)).toEqual({
      membershipId: 'membership-1',
      useCredit: false,
      requiresDeposit: false,
      balance: 0,
    });
  });

  it('crédito disponível e flag false: usa crédito e NÃO exige sinal', () => {
    expect(resolveCreditBookingDecision(coverage({ balance: 3 }), false)).toEqual({
      membershipId: 'membership-1',
      useCredit: true,
      requiresDeposit: false,
      balance: 3,
    });
  });

  it('crédito disponível e flag true: usa crédito e exige sinal (pendência de produto)', () => {
    expect(resolveCreditBookingDecision(coverage({ balance: 3 }), true)).toEqual({
      membershipId: 'membership-1',
      useCredit: true,
      requiresDeposit: true,
      balance: 3,
    });
  });

  it('a flag de sinal não inventa sinal quando não há crédito', () => {
    expect(resolveCreditBookingDecision(coverage({ balance: 0 }), true)).toMatchObject({
      useCredit: false,
      requiresDeposit: false,
    });
  });
});

describe('razões do ledger', () => {
  it('mantém os valores que o seed grava (contrato de leitura do histórico)', () => {
    expect(CREDIT_REASON.cycleGrant).toBe('cycle_grant');
    expect(CREDIT_REASON.bookingConsumed).toBe('booking_consumed');
    expect(CREDIT_REASON.bookingRefunded).toBe('booking_refunded');
    expect(CREDIT_REASON.cycleExpired).toBe('cycle_expired');
  });
});

describe('InsufficientCreditError', () => {
  it('é erro de domínio 409 com código estável', () => {
    const error = new InsufficientCreditError('sem saldo');
    expect(error.code).toBe('INSUFFICIENT_CREDIT');
    expect(error.status).toBe(409);
    expect(error.message).toBe('sem saldo');
  });
});
