// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  clientIpFromHeaders,
  decodePendingIdentity,
  encodePendingIdentity,
  generateOtpCode,
  hashOtpCode,
  otpCodesMatch,
  parseRequestOtpInput,
} from '@/lib/auth/otp';

/**
 * Contratos puros do OTP (F1.1): formato do código, hash, comparação em tempo
 * constante, cookie pendente assinado e validação de entrada. Comportamento de
 * banco/HTTP fica nos testes de integração.
 */
describe('OTP: constantes de defesa', () => {
  it('código de 6 dígitos, TTL de 5 minutos e 5 tentativas por desafio (fase-1 §2)', () => {
    expect(OTP_CODE_LENGTH).toBe(6);
    expect(OTP_TTL_SECONDS).toBe(5 * 60);
    expect(OTP_MAX_ATTEMPTS).toBe(5);
    expect(OTP_RESEND_COOLDOWN_SECONDS).toBeGreaterThan(0);
  });
});

describe('generateOtpCode', () => {
  it('gera sempre 6 dígitos, com zero à esquerda preservado', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashOtpCode / otpCodesMatch', () => {
  it('o hash é determinístico e diferente do código', () => {
    const hash = hashOtpCode('123456');
    expect(hash).toBe(hashOtpCode('123456'));
    expect(hash).not.toBe('123456');
    expect(hash).not.toContain('123456');
  });

  it('código diferente produz hash diferente', () => {
    expect(hashOtpCode('123456')).not.toBe(hashOtpCode('654321'));
  });

  it('compara em tempo constante e recusa código errado/hash adulterado', () => {
    const stored = hashOtpCode('123456');
    expect(otpCodesMatch('123456', stored)).toBe(true);
    expect(otpCodesMatch('123457', stored)).toBe(false);
    expect(otpCodesMatch('123456', hashOtpCode('000000'))).toBe(false);
    expect(otpCodesMatch('123456', 'hash-de-outro-tamanho')).toBe(false);
  });
});

describe('cookie pendente (nome do primeiro acesso)', () => {
  it('ida e volta preserva telefone e nome', () => {
    const value = encodePendingIdentity('+5548999999999', 'Ana Souza');
    expect(decodePendingIdentity(value)).toEqual({
      phone: '+5548999999999',
      name: 'Ana Souza',
    });
  });

  it('payload adulterado ou assinatura trocada é recusado', () => {
    const value = encodePendingIdentity('+5548999999999', 'Ana Souza');
    const [, signature] = value.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ phone: '+5548888888888', name: 'Outra Pessoa' }),
      'utf8',
    ).toString('base64url');

    expect(decodePendingIdentity(`${forgedPayload}.${signature}`)).toBeNull();
    expect(decodePendingIdentity(`${value}x`)).toBeNull();
    expect(decodePendingIdentity(null)).toBeNull();
    expect(decodePendingIdentity('sem-assinatura')).toBeNull();
  });
});

describe('parseRequestOtpInput', () => {
  it('normaliza espaços e aceita nome + E.164', () => {
    expect(
      parseRequestOtpInput({ name: '  Ana Souza  ', phone: ' +5548999999999 ' }),
    ).toEqual({ ok: true, name: 'Ana Souza', phone: '+5548999999999' });
  });

  it('recusa nome vazio e telefone fora de E.164', () => {
    expect(parseRequestOtpInput({ name: '   ', phone: '+5548999999999' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(parseRequestOtpInput({ name: 'Ana', phone: '48999999999' })).toMatchObject({
      ok: false,
      code: 'INVALID_PHONE',
    });
    expect(parseRequestOtpInput({ name: 'Ana', phone: '+5548' })).toMatchObject({
      ok: false,
      code: 'INVALID_PHONE',
    });
  });

  it('recusa nome absurdamente longo', () => {
    expect(
      parseRequestOtpInput({ name: 'a'.repeat(200), phone: '+5548999999999' }),
    ).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
});

describe('clientIpFromHeaders', () => {
  it('usa o primeiro valor de x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
    expect(clientIpFromHeaders(headers)).toBe('203.0.113.7');
  });

  it('cai para x-real-ip e devolve null sem header', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
