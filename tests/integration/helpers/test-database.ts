import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';

/**
 * Infra dos testes de integração (RLS e exclusão de agenda).
 *
 * Por que a role `kg_rls_app`: o Postgres dá bypass de RLS a superusers. O
 * usuário de desenvolvimento/CI (`kg`) é superuser, então testar isolamento
 * conectado como ele não provaria nada. O setup cria uma role comum com
 * privilégios de DML; os testes de RLS abrem o client escopado apontando para
 * ela. Em produção a DATABASE_URL já é de uma role comum — o esquema é o mesmo.
 */

const RLS_ROLE = 'kg_rls_app';
const RLS_PASSWORD = 'kg_rls_app';

export function databaseUrl(): string {
  if (!process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL não definida. Suba o Postgres (docker compose up -d) e copie .env.example para .env.',
    );
  }
  return url;
}

/**
 * Dono do banco: cria a role de teste, aplica migrations e monta fixtures.
 * `DATABASE_URL` aponta para a role de aplicação (sem superuser), que não pode
 * `ALTER ROLE` nem criar tabela — é justamente o ponto de ter as duas.
 */
export function ownerDatabaseUrl(): string {
  // Chama databaseUrl() primeiro de propósito: é ele que carrega o .env. Ler
  // DIRECT_DATABASE_URL antes disso devolveria undefined e cairia no fallback,
  // que é exatamente a role sem permissão para criar role e tabela.
  const appUrl = databaseUrl();
  return process.env.DIRECT_DATABASE_URL ?? appUrl;
}

/** Connection string da role NÃO-superuser, na qual a RLS é aplicada de fato. */
export function rlsDatabaseUrl(): string {
  const url = new URL(ownerDatabaseUrl());
  url.username = RLS_ROLE;
  url.password = RLS_PASSWORD;
  return url.toString();
}

let ensured = false;

/**
 * Garante banco migrado e role de RLS criada. Idempotente e serializado por
 * advisory lock, porque arquivos de teste rodam em workers paralelos.
 */
export async function ensureTestDatabase(): Promise<void> {
  if (ensured) return;

  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: ownerDatabaseUrl() }),
  });
  try {
    await admin.$transaction(
      async (tx) => {
        // $executeRaw porque pg_advisory_xact_lock devolve `void`, que $queryRaw
        // não consegue desserializar.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('kg_test_database_setup'))`;
        runMigrations();
        await ensureRlsRole(tx);
      },
      { timeout: 180_000, maxWait: 30_000 },
    );
    ensured = true;
  } finally {
    await admin.$disconnect();
  }
}

function runMigrations(): void {
  const binary = path.join(
    process.cwd(),
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
  );
  try {
    execFileSync(binary, ['migrate', 'deploy'], {
      env: {
        ...process.env,
        // Migrations precisam do dono do banco; DATABASE_URL pode apontar para
        // a role de aplicação, que não cria tabela.
        DATABASE_URL: ownerDatabaseUrl(),
      },
      stdio: 'pipe',
    });
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
    throw new Error(`Falha ao aplicar migrations nos testes.\n${stderr}`, { cause: error });
  }
}

/**
 * `ALTER ROLE` em paralelo devolve `XX000 tuple concurrently updated` — o
 * catálogo de roles é global e não tem trava por linha. Acontece quando a suíte
 * roda em workers paralelos ou quando um `db:reset` coincide com os testes.
 * Repetir resolve; o comando é idempotente.
 */
async function withRoleRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const code = (error as { meta?: { code?: string } })?.meta?.code;
      const message = error instanceof Error ? error.message : String(error);
      const concurrent = code === 'XX000' || message.includes('tuple concurrently updated');
      if (!concurrent) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (i + 1)));
    }
  }
  throw lastError;
}

async function ensureRlsRole(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
        CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}';
      END IF;
    END $$;
  `);
  await withRoleRetry(() =>
    tx.$executeRawUnsafe(`ALTER ROLE ${RLS_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`),
  );
  await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await tx.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE}`);
  await tx.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE}`);
  await tx.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${RLS_ROLE}`,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export interface TenantFixture {
  tenantId: string;
  ownerMemberId: string;
  staffMemberId: string;
  customerMemberId: string;
  staffId: string;
  serviceId: string;
  bookingId: string;
}

const FIXTURE_START = new Date('2026-11-03T13:00:00.000Z');

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

/**
 * Cria um tenant completo e realista o suficiente para os testes de isolamento:
 * owner, staff e customer como TenantMembers distintos, StaffProfile, Service
 * e um Booking.
 */
export async function createTenantFixture(admin: TenantDb, prefix = 'tenant'): Promise<TenantFixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');

  return admin.asPlatformAdmin(async (tx) => {
    const tenant = await tx.tenant.create({
      data: { slug: `${prefix}-${suffix}`, name: `Tenant ${suffix}`, document: '12345678901' },
    });

    const [ownerUser, staffUser, customerUser] = await Promise.all([
      tx.user.create({ data: { phone: randomPhone(), name: `Owner ${suffix}` } }),
      tx.user.create({ data: { phone: randomPhone(), name: `Staff ${suffix}` } }),
      tx.user.create({ data: { phone: randomPhone(), name: `Customer ${suffix}` } }),
    ]);

    const [ownerMember, staffMember, customerMember] = await Promise.all([
      tx.tenantMember.create({ data: { tenantId: tenant.id, userId: ownerUser.id, role: 'OWNER' } }),
      tx.tenantMember.create({ data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' } }),
      tx.tenantMember.create({ data: { tenantId: tenant.id, userId: customerUser.id, role: 'CUSTOMER' } }),
    ]);

    const staff = await tx.staffProfile.create({
      data: { tenantId: tenant.id, tenantMemberId: staffMember.id },
    });

    const service = await tx.service.create({
      data: {
        tenantId: tenant.id,
        name: 'Corte',
        durationMin: 30,
        bufferMin: 10,
        priceCents: 5000,
        paymentMode: 'ON_SITE',
      },
    });

    const booking = await tx.booking.create({
      data: {
        tenantId: tenant.id,
        customerId: customerMember.id,
        staffId: staff.id,
        serviceId: service.id,
        startsAt: FIXTURE_START,
        endsAt: new Date(FIXTURE_START.getTime() + 30 * 60_000),
        blockedUntil: new Date(FIXTURE_START.getTime() + 40 * 60_000),
        status: 'HOLD',
        holdExpiresAt: new Date(FIXTURE_START.getTime() + 10 * 60_000),
        priceCents: 5000,
        source: 'PORTAL',
      },
    });

    return {
      tenantId: tenant.id,
      ownerMemberId: ownerMember.id,
      staffMemberId: staffMember.id,
      customerMemberId: customerMember.id,
      staffId: staff.id,
      serviceId: service.id,
      bookingId: booking.id,
    };
  });
}

/**
 * Remove o tenant e tudo que pende dele (as FKs são ON DELETE CASCADE) — e
 * também os `user` que ficariam órfãos.
 *
 * `user` é global de propósito (identidade por telefone atravessa tenants), por
 * isso NÃO cascateia de `tenant`. Sem esta limpeza, cada execução da suíte
 * abandona linhas: o banco de desenvolvimento acumula lixo e, como `phone` é
 * unique, uma colisão futura com um telefone sorteado viraria falha
 * intermitente — o pior tipo de teste para diagnosticar.
 */
export async function deleteTenant(admin: TenantDb, tenantId: string): Promise<void> {
  await admin.asPlatformAdmin(async (tx) => {
    const members = await tx.tenantMember.findMany({
      where: { tenantId },
      select: { userId: true },
    });
    await tx.tenant.delete({ where: { id: tenantId } });
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      // Só apaga quem não sobrou em nenhum outro tenant.
      await tx.user.deleteMany({
        where: { id: { in: userIds }, memberships: { none: {} } },
      });
    }
  });
}

export function createAdminDb(): TenantDb {
  return createTenantDb(ownerDatabaseUrl());
}
