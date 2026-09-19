// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CheckoutConfigError,
  computePlatformFeeCents,
  getPlatformFeeBasisPoints,
  getPlatformWalletId,
  resolveChargeAmountCents,
} from '@/lib/payments/charge';

/**
 * Regras puras do checkout (F4.2): taxa em pontos-base (nunca número mágico) e
 * valor por modalidade. Testes de unidade porque não tocam banco nem provedor.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('taxa da plataforma', () => {
  it('converte pontos-base em centavos', () => {
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '1000');
    expect(getPlatformFeeBasisPoints()).toBe(1000);
    expect(computePlatformFeeCents(5000)).toBe(500);
  });

  it('exige a configuração e recusa valores não inteiros', () => {
    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '');
    expect(() => getPlatformFeeBasisPoints()).toThrow(CheckoutConfigError);

    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '10.5');
    expect(() => getPlatformFeeBasisPoints()).toThrow(CheckoutConfigError);

    vi.stubEnv('PLATFORM_FEE_BASIS_POINTS', '0');
    expect(() => getPlatformFeeBasisPoints()).toThrow(CheckoutConfigError);
  });

  it('exige a carteira da plataforma', () => {
    vi.stubEnv('PLATFORM_WALLET_ID', '');
    expect(() => getPlatformWalletId()).toThrow(CheckoutConfigError);
  });
});

describe('valor por modalidade', () => {
  it('integral antecipado usa o preço cheio', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'FULL_PREPAID',
        depositCents: null,
        depositPercent: null,
      }),
    ).toBe(8000);
  });

  it('sinal prefere o valor fixo ao percentual', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'DEPOSIT',
        depositCents: 2000,
        depositPercent: 30,
      }),
    ).toBe(2000);
  });

  it('sinal por percentual arredonda em centavos', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 3333,
        paymentMode: 'DEPOSIT',
        depositCents: null,
        depositPercent: 33,
      }),
    ).toBe(Math.round((3333 * 33) / 100));
  });

  it('no local não cobra online', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'ON_SITE',
        depositCents: null,
        depositPercent: null,
      }),
    ).toBe(0);
  });

  it('sinal sem configuração cai para o integral em vez de travar', () => {
    expect(
      resolveChargeAmountCents({
        priceCents: 8000,
        paymentMode: 'DEPOSIT',
        depositCents: null,
        depositPercent: null,
      }),
    ).toBe(8000);
  });
});
