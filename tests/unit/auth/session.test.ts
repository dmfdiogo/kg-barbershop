// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COOKIE_NAME,
  SESSION_COOKIE_OPTIONS,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
} from '@/lib/auth/session';

function decodePayload(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('sessão assinada (cookie kg_session)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('ida e volta preserva userId e tenant ativo', () => {
    const session = verifySessionToken(
      createSessionToken({ userId: 'user-1', activeTenantId: 'tenant-a' }),
    );

    expect(session).not.toBeNull();
    expect(session?.userId).toBe('user-1');
    expect(session?.activeTenantId).toBe('tenant-a');
    expect(session?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('sem tenant ativo, o campo é null (nunca undefined)', () => {
    const session = verifySessionToken(createSessionToken({ userId: 'user-1' }));
    expect(session?.activeTenantId).toBeNull();
  });

  it('o PAPEL não mora no token', () => {
    const payload = decodePayload(createSessionToken({ userId: 'user-1', activeTenantId: 't' }));
    expect(Object.keys(payload).sort()).toEqual(
      ['activeTenantId', 'expiresAt', 'issuedAt', 'userId'].sort(),
    );
  });

  it('payload adulterado é recusado', () => {
    const token = createSessionToken({ userId: 'user-1' });
    const [version, payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ userId: 'user-2', activeTenantId: null, issuedAt: 1, expiresAt: 9_999_999_999 }),
      'utf8',
    ).toString('base64url');

    expect(verifySessionToken(`${version}.${forged}.${signature}`)).toBeNull();
    expect(verifySessionToken(`${version}.${payload}.${signature}x`)).toBeNull();
  });

  it('assinatura de outro segredo é recusada', () => {
    vi.stubEnv('AUTH_SESSION_SECRET', 'segredo-1');
    const token = createSessionToken({ userId: 'user-1' });

    vi.stubEnv('AUTH_SESSION_SECRET', 'segredo-2');
    expect(verifySessionToken(token)).toBeNull();
  });

  it('token expirado é recusado', () => {
    const token = createSessionToken({
      userId: 'user-1',
      ttlSeconds: 60,
      now: new Date(Date.now() - 120_000),
    });
    expect(verifySessionToken(token)).toBeNull();
  });

  it('token malformado, vazio ou de versão desconhecida é recusado', () => {
    expect(verifySessionToken(null)).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('abc')).toBeNull();
    expect(verifySessionToken('v2.abc.def')).toBeNull();
    expect(verifySessionToken('v1.not-base64.assinatura')).toBeNull();
  });

  it('o cookie é httpOnly, secure e sameSite=lax', () => {
    expect(SESSION_COOKIE_NAME).toBe('kg_session');
    expect(SESSION_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(SESSION_TTL_SECONDS).toBeGreaterThan(0);
  });
});
