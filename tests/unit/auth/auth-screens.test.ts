import { describe, expect, it } from 'vitest';
import { formatPhoneForDisplay, normalizePhoneToE164 } from '@/app/(auth)/_lib/phone';

/**
 * Normalização do WhatsApp da tela de identificação (F1.2). A server action
 * exige E.164; o cliente digita do jeito brasileiro — parênteses, hífen, às
 * vezes sem DDI. Estes são os formatos que a cliente real digita.
 */
describe('normalizePhoneToE164', () => {
  it('aceita o formato brasileiro com máscara', () => {
    expect(normalizePhoneToE164('(48) 99999-9999')).toBe('+5548999999999');
  });

  it('aceita só dígitos com DDD', () => {
    expect(normalizePhoneToE164('48999999999')).toBe('+5548999999999');
  });

  it('aceita DDD + fixo (10 dígitos)', () => {
    expect(normalizePhoneToE164('4833334444')).toBe('+554833334444');
  });

  it('respeita DDI já informado', () => {
    expect(normalizePhoneToE164('+55 48 99999-9999')).toBe('+5548999999999');
    expect(normalizePhoneToE164('+1 415 555 2671')).toBe('+14155552671');
  });

  it('aceita 55 sem o "+"', () => {
    expect(normalizePhoneToE164('5548999999999')).toBe('+5548999999999');
  });

  it('recusa vazio, curto demais ou sem dígitos', () => {
    expect(normalizePhoneToE164('')).toBeNull();
    expect(normalizePhoneToE164('   ')).toBeNull();
    expect(normalizePhoneToE164('abc')).toBeNull();
    expect(normalizePhoneToE164('123')).toBeNull();
  });
});

describe('formatPhoneForDisplay', () => {
  it('mostra número brasileiro de forma legível', () => {
    expect(formatPhoneForDisplay('+5548999999999')).toBe('+55 (48) 99999-9999');
    expect(formatPhoneForDisplay('+554833334444')).toBe('+55 (48) 3333-4444');
  });

  it('cai no formato internacional para outros países', () => {
    expect(formatPhoneForDisplay('+14155552671')).toBe('+14155552671');
  });
});
