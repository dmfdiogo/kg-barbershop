import { timingSafeEqual } from 'node:crypto';
import { runNotificationJobs } from '@/lib/messaging/jobs';

/**
 * Runner dos lembretes persistidos (tarefa F6.0, fase-6 §1).
 *
 * Os jobs nascem como linhas em `NotificationJob` e este cron os executa a
 * cada 5 minutos. O trabalho real vive em `runNotificationJobs`, que reivindica
 * cada job com `UPDATE ... RETURNING` + `FOR UPDATE SKIP LOCKED`: duas execuções
 * sobrepostas nunca enviam a mesma mensagem duas vezes.
 *
 * Autenticação: `CRON_SECRET`, o mesmo mecanismo do cron de holds (F3.2).
 * Aceita `Authorization: Bearer <secret>` (Vercel Cron) e `x-cron-secret`. Sem
 * o secret configurado falha FECHADO com 503, nunca fica aberto.
 *
 * GET e POST apontam para o mesmo handler: o Vercel Cron dispara GET.
 */

export const dynamic = 'force-dynamic';

const AUTHORIZATION_PREFIX = 'bearer ';

function safeEqual(candidate: string, secret: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const secretBytes = Buffer.from(secret);
  if (candidateBytes.length !== secretBytes.length) return false;
  return timingSafeEqual(candidateBytes, secretBytes);
}

type Authorization = 'authorized' | 'unauthorized' | 'unconfigured';

function authorize(request: Request): Authorization {
  const secret = process.env.CRON_SECRET;
  if (!secret) return 'unconfigured';

  const authorization = request.headers.get('authorization') ?? '';
  const bearer = authorization.toLowerCase().startsWith(AUTHORIZATION_PREFIX)
    ? authorization.slice(AUTHORIZATION_PREFIX.length).trim()
    : '';
  if (bearer && safeEqual(bearer, secret)) return 'authorized';

  const custom = request.headers.get('x-cron-secret') ?? '';
  if (custom && safeEqual(custom, secret)) return 'authorized';

  return 'unauthorized';
}

async function handle(request: Request): Promise<Response> {
  const authorization = authorize(request);

  if (authorization === 'unconfigured') {
    return Response.json(
      { ok: false, code: 'CRON_SECRET_UNCONFIGURED', message: 'CRON_SECRET não configurado.' },
      { status: 503 },
    );
  }
  if (authorization === 'unauthorized') {
    return Response.json(
      { ok: false, code: 'UNAUTHORIZED', message: 'Não autorizado.' },
      { status: 401 },
    );
  }

  const summary = await runNotificationJobs();
  return Response.json({ ok: true, ...summary });
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
