// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/cron/expire-holds/route';
import { createHold } from '@/lib/booking/hold';
import { type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Cron de expiração de holds (F3.2): rede de segurança autenticada por
 * CRON_SECRET. O mecanismo principal é a limpeza na criação do hold; aqui se
 * prova que a varredura apaga só o que venceu e nunca fica aberta.
 */

const CRON_SECRET = 'cron-secret-de-teste';
const URL = 'http://localhost/api/cron/expire-holds';

describe('GET /api/cron/expire-holds', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let second: TenantFixture;

  let expiredA: string;
  let expiredB: string;
  let activeA: string;
  let confirmedA: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'cron');
    second = await createTenantFixture(admin, 'cron-b');

    // Vigente agora: não pode ser tocado. Criado ANTES dos vencidos de
    // propósito: a limpeza do `createHold` apaga os vencidos do MESMO
    // profissional, então um hold vigente criado depois varreria os vencidos
    // que este teste quer deixar para o cron.
    activeA = (
      await createHold({
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        startsAt: new Date('2026-12-20T13:00:00.000Z'),
        holdSessionId: 'active-a',
      })
    ).id;

    // CONFIRMED com holdExpiresAt vencido: status manda, não pode ser tocado.
    confirmedA = (
      await createHold({
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        startsAt: new Date('2020-01-12T13:00:00.000Z'),
        holdSessionId: 'confirmed-a',
        now: new Date('2020-01-12T12:00:00.000Z'),
      })
    ).id;
    await admin.asPlatformAdmin((tx) =>
      tx.booking.update({ where: { id: confirmedA }, data: { status: 'CONFIRMED' } }),
    );

    // Vencidos de verdade (relógio real no passado), um por tenant, criados por
    // último para sobreviverem à limpeza dos holds anteriores.
    expiredA = (
      await createHold({
        tenantId: fixture.tenantId,
        customerId: fixture.customerMemberId,
        staffId: fixture.staffId,
        serviceId: fixture.serviceId,
        startsAt: new Date('2020-01-10T13:00:00.000Z'),
        holdSessionId: 'expired-a',
        now: new Date('2020-01-10T12:00:00.000Z'),
      })
    ).id;
    expiredB = (
      await createHold({
        tenantId: second.tenantId,
        customerId: second.customerMemberId,
        staffId: second.staffId,
        serviceId: second.serviceId,
        startsAt: new Date('2020-01-11T13:00:00.000Z'),
        holdSessionId: 'expired-b',
        now: new Date('2020-01-11T12:00:00.000Z'),
      })
    ).id;
  }, 180_000);

  afterAll(async () => {
    if (admin && fixture) await deleteTenant(admin, fixture.tenantId);
    if (admin && second) await deleteTenant(admin, second.tenantId);
    if (admin) await admin.disconnect();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function exists(id: string): Promise<boolean> {
    const row = await admin.asPlatformAdmin((tx) =>
      tx.booking.findUnique({ where: { id }, select: { id: true } }),
    );
    return row !== null;
  }

  function call(headers: Record<string, string> = {}): Promise<Response> {
    return GET(new Request(URL, { headers }));
  }

  it('sem credencial responde 401 e não apaga nada', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);

    const response = await call();

    expect(response.status).toBe(401);
    expect(await exists(expiredA)).toBe(true);
    expect(await exists(expiredB)).toBe(true);
  });

  it('com credencial errada responde 401', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);

    const response = await call({ authorization: 'Bearer token-errado' });

    expect(response.status).toBe(401);
    expect(await exists(expiredA)).toBe(true);
  });

  it('sem CRON_SECRET configurado falha fechado com 503', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await call();

    expect(response.status).toBe(503);
    expect(await exists(expiredA)).toBe(true);
  });

  it('autorizado apaga os vencidos dos dois tenants e preserva vigente e confirmado', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);

    const response = await call({ authorization: `Bearer ${CRON_SECRET}` });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; expired: number };
    expect(body.ok).toBe(true);
    // A varredura é global (todos os tenants do banco de teste), então o número
    // exato depende de outros arquivos rodando em paralelo. O que importa é que
    // os nossos vencidos saíram.
    expect(body.expired).toBeGreaterThanOrEqual(2);

    expect(await exists(expiredA)).toBe(false);
    expect(await exists(expiredB)).toBe(false);
    expect(await exists(activeA)).toBe(true);
    expect(await exists(confirmedA)).toBe(true);
  });
});
