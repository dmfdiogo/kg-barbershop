import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { forTenant } from '@/lib/tenant/db';
import { ensureMembership } from '@/lib/auth/membership';
import {
  OTP_MAX_ATTEMPTS,
  OTP_RATE_LIMITS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
  hashOtpCode,
  requestOtp,
  verifyOtp,
} from '@/lib/auth/otp';
import type { RequestOtpResult } from '@/lib/auth/types';
import { clearOutboxMessages, listOutboxMessages } from '@/lib/messaging/outbox';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * Núcleo do OTP contra Postgres real (F1.1).
 *
 * O que este arquivo prova, na ordem do "pronto quando":
 *   - código expirado, errado 5 vezes, reusado, reenvio em cooldown;
 *   - rate limit estourado por telefone E por IP, persistido em
 *     `RateLimitCounter` (não em memória);
 *   - o banco guarda hash, jamais o código legível;
 *   - resposta e tempo iguais para telefone conhecido e desconhecido.
 *
 * O código é lido do outbox do mock — exatamente como o /dev/outbox faz. Tempo
 * é injetado (`now`) para não dormir em teste nenhum.
 */

function suffix(): string {
  return randomInt(0, 999_999).toString().padStart(6, '0');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

describe('OTP: núcleo e defesas', () => {
  let admin: TenantDb;
  let tenantId: string;
  const usedPhones: string[] = [];
  const usedIps: string[] = [];
  const createdTenants: string[] = [];

  function uniquePhone(): string {
    const phone = `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
    usedPhones.push(phone);
    return phone;
  }

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

  async function createKnownCustomer(phone: string, name = 'Cliente Conhecido'): Promise<string> {
    return admin.asPlatformAdmin(async (tx) => {
      const user = await tx.user.create({ data: { phone, name }, select: { id: true } });
      await tx.tenantMember.create({ data: { tenantId, userId: user.id, role: 'CUSTOMER' } });
      return user.id;
    });
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    const tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: {
          slug: `otp-${suffix()}`,
          name: 'Tenant OTP',
          document: '12345678901',
          status: 'ACTIVE',
        },
        select: { id: true },
      }),
    );
    tenantId = tenant.id;
    createdTenants.push(tenant.id);
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
    clearOutboxMessages();
  });

  it('fluxo completo: código no outbox, verify cria User + TenantMember CUSTOMER', async () => {
    const phone = uniquePhone();
    const now = new Date();

    await expect(
      requestOtp({ tenantId, name: 'Ana Souza', phone, ip: uniqueIp(), now }),
    ).resolves.toEqual({ ok: true });

    const code = latestCodeFor(phone);
    expect(code).toMatch(/^\d{6}$/);

    const result = await verifyOtp({
      tenantId,
      phone,
      code,
      pendingName: 'Ana Souza',
      now: new Date(now.getTime() + 1000),
    });

    expect(result).toMatchObject({
      ok: true,
      role: 'CUSTOMER',
      isNewUser: true,
    });
    if (!result.ok) throw new Error('verify deveria ter passado');

    const user = await admin.asPlatformAdmin((tx) =>
      tx.user.findUnique({ where: { phone }, select: { id: true, name: true } }),
    );
    expect(user?.id).toBe(result.userId);
    expect(user?.name).toBe('Ana Souza');

    const member = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId: result.userId } },
        select: { role: true },
      }),
    );
    expect(member?.role).toBe('CUSTOMER');
  });

  it('o papel vem do TenantMember existente e o nome antigo não é sobrescrito', async () => {
    const phone = uniquePhone();
    const userId = await admin.asPlatformAdmin(async (tx) => {
      const user = await tx.user.create({
        data: { phone, name: 'Nome Original' },
        select: { id: true },
      });
      await tx.tenantMember.create({ data: { tenantId, userId: user.id, role: 'OWNER' } });
      return user.id;
    });

    const now = new Date();
    await requestOtp({ tenantId, name: 'Nome Novo', phone, ip: uniqueIp(), now });
    const result = await verifyOtp({
      tenantId,
      phone,
      code: latestCodeFor(phone),
      pendingName: 'Nome Novo',
      now: new Date(now.getTime() + 1000),
    });

    expect(result).toMatchObject({ ok: true, role: 'OWNER', isNewUser: false });
    const user = await admin.asPlatformAdmin((tx) =>
      tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
    );
    expect(user?.name).toBe('Nome Original');
  });

  it('ensureMembership aceita a transação do chamador (vínculo atômico com o OTP)', async () => {
    const phone = uniquePhone();
    const user = await admin.asPlatformAdmin((tx) =>
      tx.user.create({ data: { phone, name: 'Vínculo Atômico' }, select: { id: true } }),
    );

    const created = await forTenant(tenantId, (tx) =>
      ensureMembership(tenantId, user.id, { tx }),
    );
    expect(created.role).toBe('CUSTOMER');

    const again = await ensureMembership(tenantId, user.id);
    expect(again.id).toBe(created.id);
    expect(again.role).toBe('CUSTOMER');
  });

  it('código expirado depois do TTL de 5 minutos é recusado', async () => {
    const phone = uniquePhone();
    const now = new Date();
    await requestOtp({ tenantId, name: 'Ana', phone, ip: uniqueIp(), now });
    const code = latestCodeFor(phone);

    const result = await verifyOtp({
      tenantId,
      phone,
      code,
      now: new Date(now.getTime() + (OTP_TTL_SECONDS + 1) * 1000),
    });

    expect(result).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('errado 5 vezes invalida o desafio; o código certo depois também falha', async () => {
    const phone = uniquePhone();
    const now = new Date();
    await requestOtp({ tenantId, name: 'Ana', phone, ip: uniqueIp(), now });
    const code = latestCodeFor(phone);
    const wrongCode = code === '000000' ? '000001' : '000000';

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      const result = await verifyOtp({
        tenantId,
        phone,
        code: wrongCode,
        now: new Date(now.getTime() + attempt * 1000),
      });
      expect(result).toMatchObject({
        ok: false,
        code: 'INVALID_CODE',
        remainingAttempts: OTP_MAX_ATTEMPTS - attempt,
      });
    }

    const fifth = await verifyOtp({
      tenantId,
      phone,
      code: wrongCode,
      now: new Date(now.getTime() + OTP_MAX_ATTEMPTS * 1000),
    });
    expect(fifth).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });

    const correctAfterExhaustion = await verifyOtp({
      tenantId,
      phone,
      code,
      now: new Date(now.getTime() + (OTP_MAX_ATTEMPTS + 1) * 1000),
    });
    expect(correctAfterExhaustion).toMatchObject({ ok: false, code: 'TOO_MANY_ATTEMPTS' });
  });

  it('código é de uso único: verificar duas vezes recusa o reuso', async () => {
    const phone = uniquePhone();
    const now = new Date();
    await requestOtp({ tenantId, name: 'Ana', phone, ip: uniqueIp(), now });
    const code = latestCodeFor(phone);

    const first = await verifyOtp({
      tenantId,
      phone,
      code,
      pendingName: 'Ana',
      now: new Date(now.getTime() + 1000),
    });
    expect(first.ok).toBe(true);

    const reuse = await verifyOtp({
      tenantId,
      phone,
      code,
      now: new Date(now.getTime() + 2000),
    });
    expect(reuse).toMatchObject({ ok: false, code: 'EXPIRED' });
  });

  it('reenvio em cooldown é recusado; depois do cooldown, o código novo vale e o antigo não', async () => {
    const phone = uniquePhone();
    const ip = uniqueIp();
    const now = new Date();

    await expect(requestOtp({ tenantId, name: 'Ana', phone, ip, now })).resolves.toEqual({
      ok: true,
    });
    const firstCode = latestCodeFor(phone);

    const early = await requestOtp({
      tenantId,
      name: 'Ana',
      phone,
      ip,
      now: new Date(now.getTime() + 10_000),
    });
    expect(early).toMatchObject({ ok: false, code: 'COOLDOWN' });
    if (early.ok) throw new Error('esperava cooldown');
    expect(early.retryAfterSeconds).toBeGreaterThan(0);
    expect(early.retryAfterSeconds).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_SECONDS);

    const afterCooldown = new Date(now.getTime() + (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
    await expect(requestOtp({ tenantId, name: 'Ana', phone, ip, now: afterCooldown })).resolves.toEqual({
      ok: true,
    });
    const secondCode = latestCodeFor(phone);
    expect(secondCode).not.toBe(firstCode);

    const oldCode = await verifyOtp({
      tenantId,
      phone,
      code: firstCode,
      now: new Date(afterCooldown.getTime() + 1000),
    });
    expect(oldCode).toMatchObject({ ok: false, code: 'EXPIRED' });

    const newCode = await verifyOtp({
      tenantId,
      phone,
      code: secondCode,
      pendingName: 'Ana',
      now: new Date(afterCooldown.getTime() + 2000),
    });
    expect(newCode.ok).toBe(true);
  });

  it('rate limit por telefone: a 6ª solicitação na janela é recusada', async () => {
    const phone = uniquePhone();
    const ip = uniqueIp();
    const base = new Date();

    for (let i = 0; i < OTP_RATE_LIMITS.sendPerPhone.max; i += 1) {
      const now = new Date(base.getTime() + i * (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000);
      await expect(requestOtp({ tenantId, name: 'Ana', phone, ip, now })).resolves.toEqual({
        ok: true,
      });
    }

    const blocked = await requestOtp({
      tenantId,
      name: 'Ana',
      phone,
      ip,
      now: new Date(
        base.getTime() + OTP_RATE_LIMITS.sendPerPhone.max * (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000,
      ),
    });
    expect(blocked).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    if (blocked.ok) throw new Error('esperava rate limit');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('rate limit por IP: vale mesmo com telefones diferentes', async () => {
    const ip = uniqueIp();
    const now = new Date();

    for (let i = 0; i < OTP_RATE_LIMITS.sendPerIp.max; i += 1) {
      await expect(
        requestOtp({ tenantId, name: 'Ana', phone: uniquePhone(), ip, now }),
      ).resolves.toEqual({ ok: true });
    }

    const blocked = await requestOtp({ tenantId, name: 'Ana', phone: uniquePhone(), ip, now });
    expect(blocked).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('rate limit de verify por telefone: tentativa demais vira RATE_LIMITED', async () => {
    const phone = uniquePhone();
    const base = new Date();
    await requestOtp({ tenantId, name: 'Ana', phone, ip: uniqueIp(), now: base });
    const code = latestCodeFor(phone);

    // A 1ª verificação SUCEDE (não consome orçamento de força bruta); as
    // seguintes falham até estourar o teto, e a próxima é bloqueada antes de
    // sequer tocar no desafio.
    let last = null as Awaited<ReturnType<typeof verifyOtp>> | null;
    for (let attempt = 1; attempt <= OTP_RATE_LIMITS.verifyPerPhone.max + 2; attempt += 1) {
      last = await verifyOtp({
        tenantId,
        phone,
        code: attempt === 1 ? code : '999999',
        now: new Date(base.getTime() + attempt * 1000),
      });
    }

    expect(last).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });

  it('tentativa de verify que falha conta no rate limit; a que sucede, não', async () => {
    const phone = uniquePhone();
    const ip = uniqueIp();
    const base = new Date();
    await requestOtp({ tenantId, name: 'Ana', phone, ip, now: base });
    const code = latestCodeFor(phone);

    await verifyOtp({ tenantId, phone, code, pendingName: 'Ana', ip, now: base });
    const afterSuccess = await admin.asPlatformAdmin((tx) =>
      tx.rateLimitCounter.findMany({
        where: {
          key: { in: [`otp:verify:phone:${phone}`, `otp:verify:ip:${ip}`] },
        },
        select: { key: true, count: true },
      }),
    );
    expect(afterSuccess).toHaveLength(0);

    await verifyOtp({ tenantId, phone, code, ip, now: base });
    const afterFailure = await admin.asPlatformAdmin((tx) =>
      tx.rateLimitCounter.findMany({
        where: {
          key: { in: [`otp:verify:phone:${phone}`, `otp:verify:ip:${ip}`] },
        },
        select: { key: true, count: true },
      }),
    );
    expect(afterFailure).toHaveLength(2);
    for (const row of afterFailure) expect(row.count).toBe(1);
  });

  it('o contador de rate limit fica no banco (RateLimitCounter), não em memória', async () => {
    const phone = uniquePhone();
    const ip = uniqueIp();
    await requestOtp({ tenantId, name: 'Ana', phone, ip, now: new Date() });

    const rows = await admin.asPlatformAdmin((tx) =>
      tx.rateLimitCounter.findMany({
        where: { key: { in: [`otp:send:phone:${phone}`, `otp:send:ip:${ip}`] } },
        select: { key: true, count: true, expiresAt: true },
      }),
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.count).toBe(1);
      expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('o banco guarda hash do código, nunca o código em texto puro', async () => {
    const phone = uniquePhone();
    await requestOtp({ tenantId, name: 'Ana', phone, ip: uniqueIp(), now: new Date() });
    const code = latestCodeFor(phone);

    const challenge = await admin.asPlatformAdmin((tx) =>
      tx.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } }),
    );
    expect(challenge).not.toBeNull();
    expect(challenge?.codeHash).toBe(hashOtpCode(code));
    expect(challenge?.codeHash).not.toBe(code);
    expect(challenge?.codeHash ?? '').not.toContain(code);
  });

  it('não enumera: telefone conhecido e desconhecido têm resposta e tempo iguais', async () => {
    const knownPhone = uniquePhone();
    await createKnownCustomer(knownPhone);
    const unknownPhone = uniquePhone();

    const base = new Date();
    const spacingMs = (OTP_RESEND_COOLDOWN_SECONDS + 1) * 1000;

    function freezeRequest(phone: string, index: number): Promise<RequestOtpResult> {
      return requestOtp({
        tenantId,
        name: 'Pessoa Teste',
        phone,
        ip: uniqueIp(),
        now: new Date(base.getTime() + index * spacingMs),
      });
    }

    const knownResults: RequestOtpResult[] = [];
    const unknownResults: RequestOtpResult[] = [];
    const knownDurations: number[] = [];
    const unknownDurations: number[] = [];

    // Intercala as chamadas para que qualquer drift da máquina afete os dois
    // lados por igual; a mediana descarta o primeiro acesso ao pool.
    for (let i = 0; i < 4; i += 1) {
      const knownStart = performance.now();
      knownResults.push(await freezeRequest(knownPhone, i));
      knownDurations.push(performance.now() - knownStart);

      const unknownStart = performance.now();
      unknownResults.push(await freezeRequest(unknownPhone, i));
      unknownDurations.push(performance.now() - unknownStart);
    }

    expect(knownResults).toEqual(unknownResults);
    expect(knownResults.every((result) => result.ok)).toBe(true);

    const knownMedian = median(knownDurations.slice(1));
    const unknownMedian = median(unknownDurations.slice(1));
    expect(Math.abs(knownMedian - unknownMedian)).toBeLessThan(100);
  });
});
