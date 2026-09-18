import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import {
  OTP_PENDING_COOKIE_NAME,
  OTP_RESEND_COOLDOWN_SECONDS,
  decodePendingIdentity,
} from '@/lib/auth/otp';
import { SESSION_COOKIE_NAME, verifySessionToken } from '@/lib/auth/session';
import { logoutAction, requestOtpAction, verifyOtpAction } from '@/lib/auth/actions';
import { POST as requestOtpRoute } from '@/app/api/auth/otp/route';
import { POST as verifyOtpRoute } from '@/app/api/auth/otp/verify/route';
import { clearOutboxMessages, listOutboxMessages } from '@/lib/messaging/outbox';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * Adaptadores do OTP (F1.1): server actions que a F1.2 consome e rotas de
 * `/api/auth/**`. Aqui se prova que:
 *   - ações mapeiam tenant indisponível para `TENANT_UNAVAILABLE`;
 *   - sucesso do verify estabelece a sessão (`kg_session`) com o tenant ativo;
 *   - o nome pendente do primeiro acesso viaja em cookie assinado e é limpo;
 *   - as rotas respondem com o status HTTP certo.
 *
 * `next/headers` é mockado (como em `rbac.test.ts`): fora do runtime do Next
 * não existe request scope. O comportamento de banco/abuso está no
 * `otp.test.ts`; aqui é a cola com o runtime.
 */

const authState = vi.hoisted(() => ({
  headers: new Headers(),
  cookieJar: new Map<string, string>(),
}));

vi.mock('next/headers', () => ({
  headers: async () => authState.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = authState.cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      authState.cookieJar.set(name, value);
    },
    delete: (name: string) => {
      authState.cookieJar.delete(name);
    },
  }),
}));

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

function uniquePhone(): string {
  const phone = `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
  usedPhones.push(phone);
  return phone;
}

const usedPhones: string[] = [];
const usedIps: string[] = [];

function uniqueIp(): string {
  const ip = `test-ip-${randomUUID()}`;
  usedIps.push(ip);
  return ip;
}

function latestCodeFor(phone: string): string {
  const message = listOutboxMessages().find(
    (candidate) => candidate.to === phone && candidate.kind === 'otp',
  );
  if (!message?.code) throw new Error(`Nenhum OTP no outbox para ${phone}`);
  return message.code;
}

function postJson(path: string, body: unknown, ip: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('OTP: server actions e rotas', () => {
  let admin: TenantDb;
  let tenantId: string;
  let tenantSlug: string;
  let suspendedSlug: string;
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    const active = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: {
          slug: `otp-act-${suffix()}`,
          name: 'Tenant Actions',
          document: '12345678901',
          status: 'ACTIVE',
        },
        select: { id: true, slug: true },
      }),
    );
    tenantId = active.id;
    tenantSlug = active.slug;
    createdTenants.push(active.id);

    const suspended = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: {
          slug: `otp-susp-${suffix()}`,
          name: 'Tenant Suspenso',
          document: '12345678901',
          status: 'SUSPENDED',
        },
        select: { id: true, slug: true },
      }),
    );
    suspendedSlug = suspended.slug;
    createdTenants.push(suspended.id);
  }, 180_000);

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdTenants) await deleteTenant(admin, id);
    await admin.asPlatformAdmin(async (tx) => {
      if (usedPhones.length > 0) {
        await tx.otpChallenge.deleteMany({ where: { phone: { in: usedPhones } } });
        await tx.user.deleteMany({ where: { phone: { in: usedPhones } } });
      }
      const counterKeys = [
        ...usedPhones.flatMap((phone) => [
          `otp:send:phone:${phone}`,
          `otp:verify:phone:${phone}`,
        ]),
        ...usedIps.flatMap((ip) => [`otp:send:ip:${ip}`, `otp:verify:ip:${ip}`]),
      ];
      if (counterKeys.length > 0) {
        await tx.rateLimitCounter.deleteMany({ where: { key: { in: counterKeys } } });
      }
    });
    await admin.disconnect();
  }, 180_000);

  beforeEach(() => {
    authState.cookieJar.clear();
    authState.headers = new Headers({
      'x-tenant-host': 'localhost:3000',
      'x-tenant-slug': tenantSlug,
      'x-forwarded-for': uniqueIp(),
    });
    clearOutboxMessages();
  });

  it('requestOtpAction guarda o nome pendente em cookie assinado e envia o código', async () => {
    const phone = uniquePhone();

    await expect(requestOtpAction({ name: 'Ana Souza', phone })).resolves.toEqual({ ok: true });

    const pending = authState.cookieJar.get(OTP_PENDING_COOKIE_NAME);
    expect(pending).toBeDefined();
    expect(decodePendingIdentity(pending)).toEqual({ phone, name: 'Ana Souza' });
    expect(latestCodeFor(phone)).toMatch(/^\d{6}$/);
  });

  it('verifyOtpAction estabelece a sessão, limpa o cookie pendente e devolve o papel', async () => {
    const phone = uniquePhone();
    await requestOtpAction({ name: 'Ana Souza', phone });

    const result = await verifyOtpAction({ phone, code: latestCodeFor(phone) });
    expect(result).toEqual({ ok: true, role: 'CUSTOMER' });

    const token = authState.cookieJar.get(SESSION_COOKIE_NAME);
    expect(token).toBeDefined();
    const session = verifySessionToken(token);
    expect(session).not.toBeNull();
    expect(session?.activeTenantId).toBe(tenantId);
    expect(authState.cookieJar.has(OTP_PENDING_COOKIE_NAME)).toBe(false);

    const user = await admin.asPlatformAdmin((tx) =>
      tx.user.findUnique({ where: { phone }, select: { id: true, name: true } }),
    );
    expect(user?.id).toBe(session?.userId);
    expect(user?.name).toBe('Ana Souza');
  });

  it('tenant suspenso devolve TENANT_UNAVAILABLE sem tocar no OTP', async () => {
    authState.headers.set('x-tenant-slug', suspendedSlug);
    const phone = uniquePhone();

    await expect(requestOtpAction({ name: 'Ana', phone })).resolves.toMatchObject({
      ok: false,
      code: 'TENANT_UNAVAILABLE',
    });
    expect(listOutboxMessages()).toHaveLength(0);
  });

  it('rota POST /api/auth/otp: 200 com cookie pendente; validação vira 400', async () => {
    const phone = uniquePhone();
    const response = await requestOtpRoute(
      postJson('/api/auth/otp', { name: 'Ana Souza', phone }, uniqueIp()),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(decodePendingIdentity(authState.cookieJar.get(OTP_PENDING_COOKIE_NAME))).toEqual({
      phone,
      name: 'Ana Souza',
    });

    const invalid = await requestOtpRoute(
      postJson('/api/auth/otp', { name: 'Ana', phone: 'sem-ddi' }, uniqueIp()),
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'INVALID_PHONE' });
  });

  it('rota de verify: 200 com sessão; código errado vira 400; tenant suspenso, 403', async () => {
    const phone = uniquePhone();
    await requestOtpRoute(postJson('/api/auth/otp', { name: 'Ana', phone }, uniqueIp()));
    const code = latestCodeFor(phone);

    const wrong = await verifyOtpRoute(
      postJson('/api/auth/otp/verify', { phone, code: code === '000000' ? '000001' : '000000' }, uniqueIp()),
    );
    expect(wrong.status).toBe(400);
    await expect(wrong.json()).resolves.toMatchObject({ code: 'INVALID_CODE' });

    const ok = await verifyOtpRoute(postJson('/api/auth/otp/verify', { phone, code }, uniqueIp()));
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toEqual({ ok: true, role: 'CUSTOMER' });
    expect(authState.cookieJar.has(SESSION_COOKIE_NAME)).toBe(true);

    authState.headers.set('x-tenant-slug', suspendedSlug);
    const suspended = await verifyOtpRoute(
      postJson('/api/auth/otp/verify', { phone, code: '123456' }, uniqueIp()),
    );
    expect(suspended.status).toBe(403);
    await expect(suspended.json()).resolves.toMatchObject({ code: 'TENANT_UNAVAILABLE' });
  });

  it('rota de request responde 429 com Retry-After em cooldown', async () => {
    const phone = uniquePhone();
    const ip = uniqueIp();
    const first = await requestOtpRoute(postJson('/api/auth/otp', { name: 'Ana', phone }, ip));
    expect(first.status).toBe(200);

    const second = await requestOtpRoute(postJson('/api/auth/otp', { name: 'Ana', phone }, ip));
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: 'COOLDOWN' });
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(second.headers.get('retry-after'))).toBeLessThanOrEqual(
      OTP_RESEND_COOLDOWN_SECONDS,
    );
  });

  it('logoutAction encerra a sessão', async () => {
    authState.cookieJar.set(SESSION_COOKIE_NAME, 'token-qualquer');
    await logoutAction();
    expect(authState.cookieJar.has(SESSION_COOKIE_NAME)).toBe(false);
  });
});
