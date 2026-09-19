import { describe, expect, it } from 'vitest';
import { validateServiceForm } from '@/lib/catalog/validation';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Corte',
    durationMin: '30',
    bufferMin: '10',
    price: '50,00',
    paymentMode: 'ON_SITE',
    depositMode: 'NONE',
    depositValue: '',
    staffIds: [],
    active: true,
    ...overrides,
  };
}

describe('validateServiceForm', () => {
  it('converte preço para centavos e normaliza a entrada', () => {
    const result = validateServiceForm(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.priceCents).toBe(5000);
    expect(result.value.durationMin).toBe(30);
    expect(result.value.bufferMin).toBe(10);
    expect(result.value.paymentMode).toBe('ON_SITE');
    expect(result.value.staffIds).toEqual([]);
  });

  it('exige exatamente um sinal quando a cobrança é DEPOSIT', () => {
    const semSinal = validateServiceForm(baseInput({ paymentMode: 'DEPOSIT' }));
    expect(semSinal.ok).toBe(false);

    const comValor = validateServiceForm(
      baseInput({ paymentMode: 'DEPOSIT', depositMode: 'CENTS', depositValue: '15,00' }),
    );
    expect(comValor.ok).toBe(true);
    if (comValor.ok) {
      expect(comValor.value.depositCents).toBe(1500);
      expect(comValor.value.depositPercent).toBeNull();
    }

    const comPercentual = validateServiceForm(
      baseInput({ paymentMode: 'DEPOSIT', depositMode: 'PERCENT', depositValue: '30' }),
    );
    expect(comPercentual.ok).toBe(true);
    if (comPercentual.ok) {
      expect(comPercentual.value.depositPercent).toBe(30);
      expect(comPercentual.value.depositCents).toBeNull();
    }
  });

  it('recusa sinal maior que o preço', () => {
    const result = validateServiceForm(
      baseInput({ paymentMode: 'DEPOSIT', depositMode: 'CENTS', depositValue: '80,00' }),
    );
    expect(result.ok).toBe(false);
  });

  it('ignora sinal quando a cobrança não é DEPOSIT', () => {
    const result = validateServiceForm(
      baseInput({ paymentMode: 'FULL_PREPAID', depositMode: 'CENTS', depositValue: '15,00' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.depositCents).toBeNull();
      expect(result.value.depositPercent).toBeNull();
    }
  });

  it('acumula erros por campo', () => {
    const result = validateServiceForm(
      baseInput({ name: '', durationMin: '1', price: 'abc', paymentMode: 'NOPE' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      'durationMin',
      'name',
      'paymentMode',
      'price',
    ]);
  });

  it('deduplica profissionais habilitados', () => {
    const result = validateServiceForm(baseInput({ staffIds: ['a', 'a', 'b', ' '] }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.staffIds).toEqual(['a', 'b']);
  });
});
