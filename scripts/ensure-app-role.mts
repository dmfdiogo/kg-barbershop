/**
 * Cria a role de aplicação — NÃO superuser, NÃO bypassrls — e concede a ela o
 * necessário para a aplicação funcionar.
 *
 * Por que isto existe: superuser ignora Row Level Security por completo. Se o
 * `DATABASE_URL` de desenvolvimento aponta para o dono do banco, a segunda
 * camada de isolamento (a RLS) fica inerte em dev, e só os testes a exercitam.
 * Uma query que esqueceu de escopar o tenant passaria em dev e vazaria em
 * produção — exatamente o cenário que a diretriz §9.3 da spec proíbe.
 *
 * Depois de `prisma migrate reset` as tabelas são recriadas e as permissões se
 * perdem, por isso o script roda no fim do `db:reset`.
 *
 * Use com dois URLs no .env:
 *   DIRECT_DATABASE_URL  dono do banco — migrations, seed e este script
 *   DATABASE_URL         role de aplicação — o que o app usa em runtime
 */
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

if (!process.env.DIRECT_DATABASE_URL && !process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const APP_ROLE = process.env.APP_DB_ROLE ?? 'kg_app';
const APP_PASSWORD = process.env.APP_DB_PASSWORD ?? 'kg_app';

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DIRECT_DATABASE_URL (ou DATABASE_URL) não definida.');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * `ALTER ROLE` em paralelo devolve `XX000 tuple concurrently updated`: o
 * catálogo de roles é global e não tem trava por linha. Repetir resolve, porque
 * o comando é idempotente.
 */
async function withRoleRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('tuple concurrently updated')) throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (i + 1)));
    }
  }
  throw lastError;
}

try {
  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}';
      END IF;
    END $$;
  `);
  await withRoleRetry(() =>
    prisma.$executeRawUnsafe(`ALTER ROLE ${APP_ROLE} NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`),
  );
  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await prisma.$executeRawUnsafe(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
  );
  await prisma.$executeRawUnsafe(
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`,
  );
  console.log(`Role de aplicação "${APP_ROLE}" pronta (sem superuser, sem bypassrls).`);
} finally {
  await prisma.$disconnect();
}
