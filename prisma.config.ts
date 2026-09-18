import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// O Prisma 7 não lê .env automaticamente. Carregamos aqui para que
// `npm run db:migrate` funcione numa máquina limpa com o .env do .env.example.
// Variáveis já presentes no ambiente (CI, Vercel) têm precedência — loadEnvFile
// não sobrescreve process.env.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Migrations e seed precisam do DONO do banco: criam extensão, políticas e
    // escrevem entre tenants. O app em runtime usa DATABASE_URL, que aponta
    // para uma role sem superuser — é o que mantém a RLS valendo em dev.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  },
});
