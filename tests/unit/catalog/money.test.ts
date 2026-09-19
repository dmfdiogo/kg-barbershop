import { describe, expect, it } from 'vitest';
import {
  centsToInput,
  formatCentsToBRL,
  parseIntInRange,
  parseMoneyToCents,
  parsePercentToInt,
} from '@/lib/catalog/money';

/**
 * Dinheiro sem float (F2.1). O teste prova que valores fracionários NÃO são
 * aceitos como entrada monetária (o formulário manda centavos inteiros ou
 * texto) e que a formatação usa aritmética inteira.
 */
describe('parseMoneyToCents', () => {
  it('aceita texto em reais no formato pt-BR', () => {
    expect(parseMoneyToCents('50')).toBe(5000);
    expect(parseMoneyToCents('50,00')).toBe(5000);
    expect(parseMoneyToCents('50,5')).toBe(5050);
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyToCents('1.234,5')).toBe(123450);
  });

  it('aceita ponto como decimal quando não há vírgula', () => {
    expect(parseMoneyToCents('50.00')).toBe(5000);
    expect(parseMoneyToCents('0.99')).toBe(99);
  });

  it('aceita inteiro já em centavos', () => {
    expect(parseMoneyToCents(5000)).toBe(5000);
    expect(parseMoneyToCents(0)).toBe(0);
  });

  it('rejeita float, negativo, mais de duas casas e lixo', () => {
    expect(parseMoneyToCents(50.5)).toBeNull();
    expect(parseMoneyToCents(-1)).toBeNull();
    expect(parseMoneyToCents('50,999')).toBeNull();
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
  });
});

describe('formatCentsToBRL', () => {
  it('formata centavos com separador de milhar e vírgula', () => {
    expect(formatCentsToBRL(0)).toBe('R$ 0,00');
    expect(formatCentsToBRL(5000)).toBe('R$ 50,00');
    expect(formatCentsToBRL(123456)).toBe('R$ 1.234,56');
    expect(formatCentsToBRL(100000000)).toBe('R$ 1.000.000,00');
  });
});

describe('centsToInput', () => {
  it('devolve o preço para o campo sem ponto flutuante', () => {
    expect(centsToInput(123456)).toBe('1234,56');
    expect(centsToInput(5000)).toBe('50,00');
    expect(centsToInput(null)).toBe('');
  });
});

describe('parsePercentToInt e parseIntInRange', () => {
  it('percentual só aceita inteiro', () => {
    expect(parsePercentToInt('30')).toBe(30);
    expect(parsePercentToInt('30%')).toBe(30);
    expect(parsePercentToInt('30,5')).toBeNull();
  });

  it('inteiro com faixa', () => {
    expect(parseIntInRange('30', 5, 720)).toBe(30);
    expect(parseIntInRange('4', 5, 720)).toBeNull();
    expect(parseIntInRange('1.5', 0, 240)).toBeNull();
  });
});
