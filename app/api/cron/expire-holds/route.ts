import { timingSafeEqual } from 'node:crypto';
import { expireStaleHolds } from '@/lib/booking/hold';

/**
 * Rede de segurança do hold (tarefa F3.2).
 *
 * O mecanismo PRINCIPAL de liberar holds vencidos é a criação do próximo hold,
 * que apaga os vencidos do profissional na mesma transação. Este endpoint existe
 * para os holds que ninguém voltou a tentar — por isso roda espaçado, como
 * cron. Ele NÃO decide disponibilidade: só apaga `HOLD` com `holdExpiresAt`
 * vencido; a grade já ignora hold vencido (F3.1).
 *
 * Autenticação: `CRON_SECRET` (o mesmo mecanismo do Asaas — token fixo no
 * header, não HMAC). Aceita `Authorization: Bearer <secret>` (é o que o Vercel
 * Cron envia) e, por conveniência de operação, `x-cron-secret`. Sem o secret
 * configurado o endpoint falha FECHADO com 503, nunca fica aberto.
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

  const expired = await expireStaleHolds();
  return Response.json({ ok: true, expired });
}

export function GET(request: Request): Promise<Response> {
  return handle(request);
}

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
