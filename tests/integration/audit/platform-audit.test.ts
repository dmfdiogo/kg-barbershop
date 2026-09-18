import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditAction, withPlatformAudit } from '@/lib/audit';
import { createSessionToken } from '@/lib/auth/session';
import type { TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * `withPlatformAudit` é o único caminho de leitura da plataforma sobre dado de
 * tenant (F1.4). O teste prova as três propriedades do contrato:
 *
 *   1. todo acesso grava quem, o quê, qual entidade e quando;
 *   2. a TENTATIVA é commitada antes do acesso — falha posterior não apaga o
 *      rastro (o log não testemunha leitura confirmada);
 *   3. sem `isSuperAdmin` não há leitura NEM linha (fail-closed): o "quem" sai
 *      da sessão, nunca de um parâmetro do chamador.
 */

const authState = vi.hoisted(() => ({
  sessionCookie: null as string | null,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === 'kg_session' && authState.sessionCookie
        ? { name, value: authState.sessionCookie }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

describe('acesso auditado da plataforma a dado de tenant', () => {
  let admin: TenantDb;
  let fixture: TenantFixture;
  let ownerUserId: string;
  let superUser: { id: string };

  function useSession(userId: string): void {
    authState.sessionCookie = createSessionToken({
      userId,
      activeTenantId: fixture.tenantId,
    });
  }

  function auditRows() {
    return admin.asPlatformAdmin((tx) =>
      tx.auditLog.findMany({
        where: { tenantId: fixture.tenantId },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  function inspectBooking() {
    return {
      tenantId: fixture.tenantId,
      action: auditAction('Booking', 'inspect'),
      entity: 'Booking',
      entityId: fixture.bookingId,
    };
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    fixture = await createTenantFixture(admin, 'audit');

    const ownerMember = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUniqueOrThrow({
        where: { id: fixture.ownerMemberId },
        select: { userId: true },
      }),
    );
    ownerUserId = ownerMember.userId;

    superUser = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: randomPhone(), name: 'Super Auditoria', isSuperAdmin: true },
        select: { id: true },
      }),
    );
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (fixture) await deleteTenant(admin, fixture.tenantId);
      if (superUser) {
        await admin.asPlatformAdmin((tx) => tx.user.delete({ where: { id: superUser.id } }));
      }
      await admin.disconnect();
    }
  });

  beforeEach(async () => {
    authState.sessionCookie = null;
    if (admin && fixture) {
      await admin.asPlatformAdmin((tx) =>
        tx.auditLog.deleteMany({ where: { tenantId: fixture.tenantId } }),
      );
    }
  });

  it('grava quem, o quê, qual entidade e quando', async () => {
    useSession(superUser.id);
    const before = Date.now();

    const booking = await withPlatformAudit(inspectBooking(), (tx) =>
      tx.booking.findUniqueOrThrow({ where: { id: fixture.bookingId } }),
    );
    expect(booking.id).toBe(fixture.bookingId);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: fixture.tenantId,
      actorId: superUser.id,
      action: 'booking.inspect',
      entity: 'Booking',
      entityId: fixture.bookingId,
    });
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('cada acesso gera a sua linha, em ordem, sem sobrescrever', async () => {
    useSession(superUser.id);
    const list = { tenantId: fixture.tenantId, action: auditAction('Booking', 'list'), entity: 'Booking' };

    await withPlatformAudit(list, (tx) =>
      tx.booking.findMany({ where: { tenantId: fixture.tenantId } }),
    );
    await withPlatformAudit(list, (tx) =>
      tx.booking.count({ where: { tenantId: fixture.tenantId } }),
    );

    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.action)).toEqual(['booking.list', 'booking.list']);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });

  it('registra a TENTATIVA: leitura que falha depois não apaga a linha', async () => {
    useSession(superUser.id);

    await expect(
      withPlatformAudit(inspectBooking(), () => {
        throw new Error('falha simulada na leitura');
      }),
    ).rejects.toThrow('falha simulada na leitura');

    expect(await auditRows()).toHaveLength(1);
  });

  it('usuário comum (sem isSuperAdmin) é negado e não deixa linha', async () => {
    useSession(ownerUserId);

    await expect(
      withPlatformAudit(inspectBooking(), (tx) => tx.booking.findMany()),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'FORBIDDEN', status: 403 });

    expect(await auditRows()).toHaveLength(0);
  });

  it('sem sessão, nem audita nem lê', async () => {
    await expect(
      withPlatformAudit(inspectBooking(), (tx) => tx.booking.findMany()),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'UNAUTHENTICATED', status: 401 });

    expect(await auditRows()).toHaveLength(0);
  });

  it('auditAction segue a convenção entidade.verbo', () => {
    expect(auditAction('Tenant', 'support_access')).toBe('tenant.support_access');
    expect(auditAction('Booking', 'list')).toBe('booking.list');
  });
});
