import { createHmac, timingSafeEqual } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Session } from './types';

/**
 * Sessão em cookie assinado (tarefa F1.0).
 *
 * O token é OPACO e assinado com HMAC-SHA256 (`AUTH_SESSION_SECRET`). Ele
 * carrega apenas `userId` e o tenant ativo — NUNCA o papel. Papel é par
 * (usuário, tenant), lido de `TenantMember` a cada requisição; foi a armadilha
 * "papel em token" que a fase 1 manda evitar.
 *
 * Sem dependência nova: `node:crypto` dá conta de assinar e comparar em tempo
 * constante. O repo não tem tabela de sessão (schema congelado) e não precisa:
 * revogar sessão individual é Fase 2 do produto.
 */

export const SESSION_COOKIE_NAME = 'kg_session';

/** 30 dias: o consumidor final não pode ser obrigado a refazer OTP toda hora. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const TOKEN_VERSION = 'v1';
const DEV_FALLBACK_SECRET = 'kg-dev-only-session-secret';

/**
 * `secure: true` sempre, inclusive em desenvolvimento. Navegadores tratam
 * `localhost` como origem confiável e aceitam o cookie; a alternativa (afrouxar
 * em dev) arriscava o flag vazar para produção.
 */
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

function sessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SESSION_SECRET não definida: o cookie de sessão não pode ser assinado em produção. Configure a variável (veja .env.example).',
    );
  }
  return DEV_FALLBACK_SECRET;
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

function encodePayload(payload: object): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export interface CreateSessionTokenInput {
  userId: string;
  activeTenantId?: string | null;
  ttlSeconds?: number;
  /** Injetável para teste de expiração. */
  now?: Date;
}

export function createSessionToken(input: CreateSessionTokenInput): string {
  const now = input.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const ttl = input.ttlSeconds ?? SESSION_TTL_SECONDS;

  const payload = encodePayload({
    userId: input.userId,
    activeTenantId: input.activeTenantId ?? null,
    issuedAt,
    expiresAt: issuedAt + ttl,
  });

  const unsigned = `${TOKEN_VERSION}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

/**
 * Verifica assinatura e validade. Qualquer token malformado, adulterado ou
 * expirado devolve `null` — nunca lança, para não vazar detalhe de validação.
 */
export function verifySessionToken(token: string | null | undefined, now: Date = new Date()): Session | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, payload, signature] = parts;
  if (version !== TOKEN_VERSION || !payload || !signature) return null;

  const expected = sign(`${version}.${payload}`);
  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { userId, activeTenantId, issuedAt, expiresAt } = parsed as Record<string, unknown>;
  if (typeof userId !== 'string' || userId.length === 0) return null;
  if (activeTenantId !== null && typeof activeTenantId !== 'string') return null;
  if (typeof issuedAt !== 'number' || typeof expiresAt !== 'number') return null;
  if (expiresAt * 1000 <= now.getTime()) return null;

  return {
    userId,
    activeTenantId: activeTenantId ?? null,
    issuedAt: new Date(issuedAt * 1000),
    expiresAt: new Date(expiresAt * 1000),
  };
}

/**
 * Sessão da requisição atual, memoizada. Só leitura: quem cria/troca é
 * `establishSession`/`setActiveTenant`, chamados de Server Action ou Route
 * Handler (o Next proíbe escrita de cookie em Server Component).
 *
 * ATENÇÃO (F1.1/F1.3): a memoização é por requisição. Depois de
 * `establishSession`/`setActiveTenant` na MESMA requisição, `getSession()`
 * ainda devolve o valor antigo — em server action/route handler, use o retorno
 * de quem criou, não uma nova leitura.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
});

export async function establishSession(
  userId: string,
  activeTenantId: string | null = null,
): Promise<Session> {
  const token = createSessionToken({ userId, activeTenantId });
  const session = verifySessionToken(token);
  if (!session) throw new Error('Falha ao emitir a sessão — token recém-criado não verificou.');

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_TTL_SECONDS,
  });
  return session;
}

/**
 * Troca o tenant ativo sem refazer OTP. A F1.3 usa na troca de contexto; o
 * papel não muda junto — ele continua sendo lido de `TenantMember` do tenant
 * selecionado.
 */
export async function setActiveTenant(tenantId: string): Promise<Session> {
  const current = await getSession();
  if (!current) throw new Error('Não há sessão para trocar de tenant.');
  return establishSession(current.userId, tenantId);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
