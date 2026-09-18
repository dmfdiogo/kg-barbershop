// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { firstIpFromHeader, isPublicIp, resolvePayerIp } from '@/lib/payments/remote-ip';

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '200.160.2.3', '2001:4860:4860::8888'])(
    'aceita IP público %s',
    (ip) => {
      expect(isPublicIp(ip)).toBe(true);
    },
  );

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.10.1',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:8.8.8.8',
  ])('recusa IP privado/reservado %s', (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each(['', 'não é ip', '999.1.1.1', '8.8.8.8:443'])(
    'recusa valor que não é IP %s',
    (value) => {
      expect(isPublicIp(value)).toBe(false);
    },
  );
});

describe('resolvePayerIp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('devolve o IP público extraído do header, em qualquer ambiente', () => {
    expect(resolvePayerIp('8.8.8.8')).toBe('8.8.8.8');

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PAYER_IP', '1.1.1.1');
    expect(resolvePayerIp('8.8.8.8')).toBe('8.8.8.8');
  });

  it('em desenvolvimento, usa DEV_PAYER_IP quando o valor é loopback', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PAYER_IP', '8.8.8.8');

    expect(resolvePayerIp('127.0.0.1')).toBe('8.8.8.8');
    expect(resolvePayerIp('::1')).toBe('8.8.8.8');
  });

  it('fora de desenvolvimento ignora DEV_PAYER_IP', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DEV_PAYER_IP', '8.8.8.8');

    expect(resolvePayerIp('127.0.0.1')).toBe('127.0.0.1');
  });

  it('não aceita DEV_PAYER_IP inválido nem ausência de valor', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DEV_PAYER_IP', '192.168.0.1');

    expect(resolvePayerIp('127.0.0.1')).toBe('127.0.0.1');
    expect(resolvePayerIp(undefined)).toBeUndefined();
    expect(resolvePayerIp('')).toBeUndefined();
  });
});

describe('firstIpFromHeader', () => {
  it('usa o primeiro IP da cadeia de proxy e descarta porta', () => {
    expect(firstIpFromHeader('8.8.8.8, 10.0.0.1')).toBe('8.8.8.8');
    expect(firstIpFromHeader('8.8.8.8:443')).toBe('8.8.8.8');
    expect(firstIpFromHeader('[2001:4860:4860::8888]:443')).toBe('2001:4860:4860::8888');
  });

  it('devolve null quando não há IP válido (nunca cai no IP do servidor)', () => {
    expect(firstIpFromHeader(undefined)).toBeNull();
    expect(firstIpFromHeader(null)).toBeNull();
    expect(firstIpFromHeader('unknown, desconhecido')).toBeNull();
    expect(firstIpFromHeader('')).toBeNull();
  });
});
