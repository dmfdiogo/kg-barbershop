import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTenantDb,
  type TenantDb,
} from '@/lib/tenant/db';
import { postgresErrorCode } from '@/lib/tenant/errors';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from './helpers/test-database';

interface RlsCoverageRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_policy: boolean;
}

describe('isolamento entre tenants (RLS)', () => {
  let admin: TenantDb;
  let db: TenantDb;
  let raw: PrismaClient;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    // O client escopado dos testes aponta para a role NÃO-superuser: é o único
    // jeito de a RLS ser realmente aplicada (superuser sempre a ignora).
    db = createTenantDb(rlsDatabaseUrl());
    raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: rlsDatabaseUrl() }) });
    tenantA = await createTenantFixture(admin, 'iso-a');
    tenantB = await createTenantFixture(admin, 'iso-b');
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.tenantId);
      if (tenantB) await deleteTenant(admin, tenantB.tenantId);
    }
    if (raw) await raw.$disconnect();
    if (db) await db.disconnect();
    if (admin) await admin.disconnect();
  });

  it('toda tabela de negócio tem RLS forçada e a policy tenant_isolation', async () => {
    const rows = await admin.asPlatformAdmin((tx) =>
      tx.$queryRaw<RlsCoverageRow[]>`
        SELECT c.relname AS table_name,
               c.relrowsecurity AS rls_enabled,
               c.relforcerowsecurity AS rls_forced,
               EXISTS (
                 SELECT 1 FROM pg_policies p
                 WHERE p.schemaname = 'public'
                   AND p.tablename = c.relname
                   AND p.policyname = 'tenant_isolation'
               ) AS has_policy
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND (
            c.relname = 'Tenant'
            OR EXISTS (
              SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public'
                AND col.table_name = c.relname
                AND col.column_name = 'tenantId'
            )
          )
        ORDER BY c.relname
      `,
    );

    // Tenant + 17 tabelas de negócio (migration 20260918142000).
    expect(rows.length).toBeGreaterThanOrEqual(18);
    for (const row of rows) {
      expect(row, `tabela ${row.table_name}`).toMatchObject({
        rls_enabled: true,
        rls_forced: true,
        has_policy: true,
      });
    }
  });

  it('findMany sem where enxerga apenas o próprio tenant', async () => {
    const [bookings, members, staff, services, jobs] = await db.forTenant(tenantA.tenantId, (tx) =>
      Promise.all([
        tx.booking.findMany(),
        tx.tenantMember.findMany(),
        tx.staffProfile.findMany(),
        tx.service.findMany(),
        tx.notificationJob.findMany(),
      ]),
    );

    expect(bookings.map((row) => row.tenantId)).toEqual([tenantA.tenantId]);
    expect(members.every((row) => row.tenantId === tenantA.tenantId)).toBe(true);
    expect(members).toHaveLength(3);
    expect(staff.every((row) => row.tenantId === tenantA.tenantId)).toBe(true);
    expect(services.every((row) => row.tenantId === tenantA.tenantId)).toBe(true);
    expect(jobs).toHaveLength(0);
  });

  it('não lê nem escreve dado do outro tenant por id', async () => {
    const found = await db.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: tenantB.bookingId } }),
    );
    expect(found).toBeNull();

    await expect(
      db.forTenant(tenantA.tenantId, (tx) =>
        tx.booking.update({ where: { id: tenantB.bookingId }, data: { priceCents: 1 } }),
      ),
    ).rejects.toMatchObject({ code: 'P2025' });

    const untouched = await admin.asPlatformAdmin((tx) =>
      tx.booking.findUnique({ where: { id: tenantB.bookingId }, select: { priceCents: true } }),
    );
    expect(untouched?.priceCents).toBe(5000);
  });

  it('create com tenantId de outro tenant é barrado pela policy (42501)', async () => {
    const attempt = db.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.create({
        data: {
          tenantId: tenantB.tenantId,
          customerId: tenantB.customerMemberId,
          staffId: tenantB.staffId,
          serviceId: tenantB.serviceId,
          startsAt: new Date('2027-01-04T10:00:00.000Z'),
          endsAt: new Date('2027-01-04T10:30:00.000Z'),
          blockedUntil: new Date('2027-01-04T10:40:00.000Z'),
          status: 'HOLD',
          priceCents: 1,
        },
      }),
    );

    let caught: unknown;
    try {
      await attempt;
    } catch (error) {
      caught = error;
    }
    expect(postgresErrorCode(caught)).toBe('42501');

    const count = await admin.asPlatformAdmin((tx) =>
      tx.booking.count({ where: { tenantId: tenantB.tenantId } }),
    );
    expect(count).toBe(1);
  });

  it('o caminho "esperto" (join) também fica escopado', async () => {
    const rows = await db.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.findMany({
        include: { customer: { include: { user: true } }, staff: true, service: true },
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.customer.tenantId).toBe(tenantA.tenantId);
    expect(rows[0]?.customer.id).toBe(tenantA.customerMemberId);
    expect(rows[0]?.customer.user.phone).not.toBe('');

    const otherMember = await db.forTenant(tenantA.tenantId, (tx) =>
      tx.tenantMember.findUnique({ where: { id: tenantB.customerMemberId } }),
    );
    expect(otherMember).toBeNull();
  });

  it('asPlatformAdmin() é o caminho explícito e enxerga os dois tenants', async () => {
    const bookings = await admin.asPlatformAdmin((tx) =>
      tx.booking.findMany({ where: { id: { in: [tenantA.bookingId, tenantB.bookingId] } } }),
    );
    expect(bookings).toHaveLength(2);

    const tenants = await admin.asPlatformAdmin((tx) =>
      tx.tenant.findMany({ where: { id: { in: [tenantA.tenantId, tenantB.tenantId] } } }),
    );
    expect(tenants).toHaveLength(2);
  });

  it('forTenant faz o SET LOCAL valer dentro da transação interativa (PrismaPg)', async () => {
    const rows = await db.forTenant(
      tenantA.tenantId,
      (tx) =>
        tx.$queryRaw<{ setting: string | null }[]>`
          SELECT current_setting('app.current_tenant', true) AS setting
        `,
    );
    expect(rows[0]?.setting).toBe(tenantA.tenantId);
  });

  it('SET LOCAL fora de transação não tem efeito — e a RLS falha fechado', async () => {
    // Equivalente a SET LOCAL: o Postgres não erra, apenas não persiste (só
    // emite warning), porque não há transação para durar até o fim.
    await raw.$queryRaw`SELECT set_config('app.current_tenant', ${tenantA.tenantId}, true)`;

    const setting = await raw.$queryRaw<{ setting: string | null }[]>`
      SELECT current_setting('app.current_tenant', true) AS setting
    `;
    expect(setting[0]?.setting ?? '').toBe('');

    // O tenant A tem agendamento; sem contexto válido, o resultado é zero —
    // nunca dado de outro tenant.
    const visible = await raw.booking.findMany();
    expect(visible).toHaveLength(0);
  });
});
