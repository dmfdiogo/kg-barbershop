import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { getWhatsAppProvider } from '@/lib/messaging';
import { OTP_CODE_PATTERN, isE164 } from '@/lib/messaging/types';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import { ensureMembership } from './membership';
import type {
  RequestOtpErrorCode,
  RequestOtpInput,
  RequestOtpResult,
  Role,
  VerifyOtpErrorCode,
  VerifyOtpInput,
  VerifyOtpResult,
} from './types';

/**
 * Núcleo do OTP (tarefa F1.1).
 *
 * Este é o endpoint mais atacável do produto: é anônimo, gera custo por
 * mensagem quando a integração real chegar e dá acesso à conta. As defesas
 * abaixo são ESCOPO, não extra:
 *
 *   - o código nunca toca o banco em texto puro — `OtpChallenge.codeHash`
 *     guarda HMAC-SHA256 com um segredo da aplicação (ver `otpHashKey`), então
 *     vazamento do banco sozinho não permite testar o milhão de combinações;
 *   - TTL de 5 minutos e uso único (consumo atômico via `updateMany`);
 *   - no máximo 5 tentativas por desafio, depois invalida;
 *   - cooldown de reenvio por telefone;
 *   - rate limit por telefone E por IP em `RateLimitCounter` (tabela, não
 *     memória: em serverless contador em memória não sobrevive);
 *   - comparação em tempo constante (`timingSafeEqual` sobre os hashes);
 *   - nenhuma leitura de `User`/`TenantMember` no pedido de código, para que
 *     responder a telefone conhecido e desconhecido seja o MESMO caminho —
 *     é o que impede enumerar a base de clientes do salão.
 *
 * Efeito externo (envio de WhatsApp) acontece DEPOIS do commit, nunca dentro da
 * callback do client escopado: a callback pode ser reexecutada em retry
 * (contexto-comum.md §4) e mensagem enviada duas vezes é dinheiro queimado.
 *
 * A sessão NÃO é criada aqui: `establishSession` vive em `./session` e depende
 * de `next/headers`. Quem faz isso são os adaptadores (`actions.ts` e as rotas
 * de `app/api/auth/**`), que recebem `userId`/`role` daqui.
 */

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_SECONDS = 5 * 60;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_NAME_LENGTH = 120;

/**
 * Limites de janela fixa. Valores de produto (mensagem no WhatsApp custa
 * dinheiro de verdade na F8); ajustar aqui é o único lugar.
 *
 * O teto por TELEFONE é a defesa precisa. O teto por IP é rede grossa contra
 * automação e é folgado de propósito: operadoras móveis no Brasil usam CGNAT em
 * larga escala, então milhares de clientes reais saem pelo mesmo IP público —
 * um teto apertado barra a cliente no 4G num sábado e não barra o atacante, que
 * troca de IP (fase-1-multitenant-auth.md §2).
 */
export const OTP_RATE_LIMITS = {
  sendPerPhone: { max: 5, windowSeconds: 60 * 60 },
  sendPerIp: { max: 100, windowSeconds: 60 * 60 },
  verifyPerPhone: { max: 10, windowSeconds: 15 * 60 },
  // O contador de verify conta SÓ tentativas que falham: login bem-sucedido não
  // consome orçamento de força bruta.
  verifyPerIp: { max: 200, windowSeconds: 15 * 60 },
} as const;

/**
 * O nome do primeiro acesso não cabe em `OtpChallenge` (schema congelado) e
 * `VerifyOtpInput` não o carrega (contrato da F1.0). Em vez de criar `User`
 * antes de provar posse do telefone — o que permitiria envenenar o nome de
 * outra pessoa e encher a tabela de contas não verificadas —, o adaptador
 * guarda `{phone, name}` num cookie curto, assinado, httpOnly, e o verify só o
 * usa quando vai CRIAR o usuário e o telefone bate. É apagado no sucesso.
 */
export const OTP_PENDING_COOKIE_NAME = 'kg_otp_pending';

export const OTP_PENDING_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: OTP_TTL_SECONDS,
} as const;

// ---------------------------------------------------------------------------
// Segredos e criptografia
// ---------------------------------------------------------------------------

// Mesmo fallback de `lib/auth/session.ts`, e de propósito: em dev/test a sessão
// assina com este valor quando `AUTH_SESSION_SECRET` não está definida.
const DEV_FALLBACK_SECRET = 'kg-dev-only-session-secret';

/**
 * Chave do HMAC do código e da assinatura do cookie pendente, derivada de
 * `AUTH_SESSION_SECRET`. Derivação com contexto próprio (`kg-otp-hash-v1`) em
 * vez de usar o segredo direto: o mesmo material nunca é chave de duas
 * construções. Não há variável de ambiente nova — a F1.0 já exige o segredo em
 * produção, e um segredo dedicado só acrescentaria risco de configuração.
 */
function otpHashKey(): Buffer {
  const base = process.env.AUTH_SESSION_SECRET?.trim();
  if (!base && process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_SESSION_SECRET não definida: o hash do OTP não pode ser calculado em produção. Configure a variável (veja .env.example).',
    );
  }
  return createHmac('sha256', base || DEV_FALLBACK_SECRET).update('kg-otp-hash-v1').digest();
}

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, '0');
}

export function hashOtpCode(code: string): string {
  return createHmac('sha256', otpHashKey()).update(`code:${code}`).digest('base64');
}

/** Compara o código informado com o hash guardado sem vazar tempo por dígito. */
export function otpCodesMatch(candidate: string, storedHash: string): boolean {
  const candidateBuffer = Buffer.from(hashOtpCode(candidate), 'utf8');
  const storedBuffer = Buffer.from(storedHash, 'utf8');
  if (candidateBuffer.length !== storedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, storedBuffer);
}

export function encodePendingIdentity(phone: string, name: string): string {
  const payload = Buffer.from(JSON.stringify({ phone, name }), 'utf8').toString('base64url');
  const signature = createHmac('sha256', otpHashKey()).update(`pending:${payload}`).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodePendingIdentity(
  value: string | null | undefined,
): { phone: string; name: string } | null {
  if (!value) return null;

  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;

  const expected = createHmac('sha256', otpHashKey()).update(`pending:${payload}`).digest('base64url');
  const providedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      phone?: unknown;
      name?: unknown;
    };
    if (typeof parsed.phone !== 'string' || typeof parsed.name !== 'string') return null;
    return { phone: parsed.phone, name: parsed.name };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Leitura de request
// ---------------------------------------------------------------------------

export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * IP do cliente para o rate limit. Em plataformas com proxy (Vercel/Cloudflare)
 * o primeiro valor de `x-forwarded-for` é o cliente; `x-real-ip` é o fallback.
 * Sem header, devolve `null` e o limite por IP simplesmente não é aplicado — o
 * limite por telefone continua valendo.
 */
export function clientIpFromHeaders(headers: HeaderReader): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = headers.get('x-real-ip')?.trim();
  return real && real.length > 0 ? real : null;
}

// ---------------------------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------------------------

export type ParsedRequestOtp =
  | { ok: true; name: string; phone: string }
  | Extract<RequestOtpResult, { ok: false }>;

/**
 * Normaliza e valida o pedido de código. Exportado porque o adaptador precisa
 * do par normalizado antes de decidir o que guardar no cookie pendente.
 */
export function parseRequestOtpInput(input: RequestOtpInput): ParsedRequestOtp {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const phone = typeof input?.phone === 'string' ? input.phone.trim() : '';

  if (name.length === 0 || name.length > OTP_MAX_NAME_LENGTH) {
    return requestOtpFailure('INVALID_INPUT');
  }
  if (!isE164(phone)) {
    return requestOtpFailure('INVALID_PHONE');
  }
  return { ok: true, name, phone };
}

function requestOtpFailure(
  code: RequestOtpErrorCode,
  retryAfterSeconds?: number,
): Extract<RequestOtpResult, { ok: false }> {
  const message = (() => {
    switch (code) {
      case 'INVALID_INPUT':
        return 'Confira os dados informados.';
      case 'INVALID_PHONE':
        return 'Informe o WhatsApp com DDD, no formato +5548999999999.';
      case 'COOLDOWN':
        return 'Aguarde alguns segundos para pedir um novo código.';
      case 'RATE_LIMITED':
        return 'Muitas solicitações. Tente novamente mais tarde.';
      case 'TENANT_UNAVAILABLE':
        return 'Este estabelecimento não está disponível.';
    }
  })();
  return retryAfterSeconds === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, retryAfterSeconds };
}

function verifyOtpFailure(
  code: VerifyOtpErrorCode,
  remainingAttempts?: number,
): Extract<VerifyOtpResult, { ok: false }> {
  const message = (() => {
    switch (code) {
      case 'INVALID_CODE':
        return 'Código incorreto. Confira os 6 dígitos e tente de novo.';
      case 'EXPIRED':
        return 'Este código expirou. Peça um novo código.';
      case 'TOO_MANY_ATTEMPTS':
        return 'Muitas tentativas incorretas. Peça um novo código.';
      case 'RATE_LIMITED':
        return 'Muitas tentativas. Aguarde alguns minutos.';
      case 'TENANT_UNAVAILABLE':
        return 'Este estabelecimento não está disponível.';
    }
  })();
  return remainingAttempts === undefined
    ? { ok: false, code, message }
    : { ok: false, code, message, remainingAttempts };
}

// ---------------------------------------------------------------------------
// Rate limit persistente (RateLimitCounter)
// ---------------------------------------------------------------------------

function addSeconds(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}

interface CounterState {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Janela fixa atômica: um único `INSERT ... ON CONFLICT` decide incremento vs.
 * reinício de janela. Duas requisições concorrentes nunca perdem contagem (nem
 * criam duas linhas — `key` é unique).
 */
async function bumpCounter(
  tx: TenantTransaction,
  key: string,
  max: number,
  windowSeconds: number,
  now: Date,
): Promise<CounterState> {
  const expiresAt = addSeconds(now, windowSeconds);
  const rows = await tx.$queryRaw<Array<{ count: number; expires_at: Date }>>`
    INSERT INTO rate_limit_counter (id, "key", window_start, "count", expires_at, created_at, updated_at)
    VALUES (${randomUUID()}, ${key}, ${now}, 1, ${expiresAt}, ${now}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN rate_limit_counter.expires_at <= ${now} THEN 1
        ELSE rate_limit_counter."count" + 1
      END,
      window_start = CASE
        WHEN rate_limit_counter.expires_at <= ${now} THEN ${now}
        ELSE rate_limit_counter.window_start
      END,
      expires_at = CASE
        WHEN rate_limit_counter.expires_at <= ${now} THEN ${expiresAt}
        ELSE rate_limit_counter.expires_at
      END,
      updated_at = ${now}
    RETURNING "count", expires_at
  `;

  const row = rows[0];
  if (!row) return { allowed: true, retryAfterSeconds: 0 };

  return {
    allowed: row.count <= max,
    retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Lê o contador SEM incrementar. Usado pelo verify, cujo contador conta só
 * falhas: se o teto estourou, bloqueia antes; se não, a falha é registrada
 * depois, no mesmo ponto em que o resultado é decidido.
 */
async function peekCounter(
  tx: TenantTransaction,
  key: string,
  max: number,
  now: Date,
): Promise<CounterState> {
  const rows = await tx.$queryRaw<Array<{ count: number; expires_at: Date }>>`
    SELECT "count", expires_at FROM rate_limit_counter WHERE "key" = ${key}
  `;
  const row = rows[0];
  if (!row || row.expires_at.getTime() <= now.getTime()) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: row.count < max,
    retryAfterSeconds: Math.max(1, Math.ceil((row.expires_at.getTime() - now.getTime()) / 1000)),
  };
}

/**
 * Registra quando um teto dispara. Se o de IP estiver batendo, provavelmente é
 * CGNAT (gente de verdade) — o log é o que permite perceber isso antes de
 * virar reclamação de cliente.
 */
function logRateLimit(scope: string, key: string): void {
  console.warn(`[otp] rate limit disparado (${scope}): ${key}`);
}

/**
 * Serializa pedido/verificação do MESMO telefone dentro da transação. Sem isso,
 * duas requisições simultâneas poderiam passar o cooldown juntas ou consumir o
 * código duas vezes — o `ON CONFLICT` do contador não cobre o desafio.
 */
async function lockPhone(tx: TenantTransaction, phone: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`otp:${phone}`}))`;
}

async function cooldownRemainingSeconds(
  tx: TenantTransaction,
  phone: string,
  now: Date,
): Promise<number | null> {
  const last = await tx.otpChallenge.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (!last) return null;

  const cooldownMs = OTP_RESEND_COOLDOWN_SECONDS * 1000;
  const elapsedMs = now.getTime() - last.createdAt.getTime();
  if (elapsedMs >= cooldownMs) return null;
  return Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
}

// ---------------------------------------------------------------------------
// Pedido de código
// ---------------------------------------------------------------------------

export interface RequestOtpParams extends RequestOtpInput {
  tenantId: string;
  ip?: string | null;
  /** Injetável para teste de TTL/cooldown/janela. */
  now?: Date;
}

type RequestOtpDbOutcome =
  | { kind: 'ok'; code: string }
  | { kind: 'cooldown'; retryAfterSeconds: number }
  | { kind: 'rate_limited'; retryAfterSeconds: number };

export async function requestOtp(params: RequestOtpParams): Promise<RequestOtpResult> {
  const parsed = parseRequestOtpInput({ name: params.name, phone: params.phone });
  if (!parsed.ok) return parsed;

  const now = params.now ?? new Date();
  const ip = params.ip ?? null;

  const outcome = await forTenant(params.tenantId, async (tx): Promise<RequestOtpDbOutcome> => {
    await lockPhone(tx, parsed.phone);

    const cooldown = await cooldownRemainingSeconds(tx, parsed.phone, now);
    if (cooldown !== null) return { kind: 'cooldown', retryAfterSeconds: cooldown };

    if (ip) {
      const ipCounter = await bumpCounter(
        tx,
        `otp:send:ip:${ip}`,
        OTP_RATE_LIMITS.sendPerIp.max,
        OTP_RATE_LIMITS.sendPerIp.windowSeconds,
        now,
      );
      if (!ipCounter.allowed) {
        logRateLimit('send-ip', `otp:send:ip:${ip}`);
        return { kind: 'rate_limited', retryAfterSeconds: ipCounter.retryAfterSeconds };
      }
    }

    const phoneCounter = await bumpCounter(
      tx,
      `otp:send:phone:${parsed.phone}`,
      OTP_RATE_LIMITS.sendPerPhone.max,
      OTP_RATE_LIMITS.sendPerPhone.windowSeconds,
      now,
    );
    if (!phoneCounter.allowed) {
      logRateLimit('send-phone', `otp:send:phone:${parsed.phone}`);
      return { kind: 'rate_limited', retryAfterSeconds: phoneCounter.retryAfterSeconds };
    }

    const code = generateOtpCode();

    // Reenvio invalida os desafios anteriores: só o código mais recente vale.
    await tx.otpChallenge.updateMany({
      where: { phone: parsed.phone, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.otpChallenge.create({
      data: {
        phone: parsed.phone,
        codeHash: hashOtpCode(code),
        expiresAt: addSeconds(now, OTP_TTL_SECONDS),
        createdAt: now,
      },
    });

    return { kind: 'ok', code };
  });

  if (outcome.kind === 'cooldown') {
    return requestOtpFailure('COOLDOWN', outcome.retryAfterSeconds);
  }
  if (outcome.kind === 'rate_limited') {
    return requestOtpFailure('RATE_LIMITED', outcome.retryAfterSeconds);
  }

  // Efeito externo FORA da transação/commit (contexto-comum.md §4): retry de
  // transação não pode mandar dois WhatsApps. O provider é escolhido pela
  // factory; nenhum adaptador é importado direto.
  await getWhatsAppProvider().sendOtp(parsed.phone, outcome.code);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Verificação
// ---------------------------------------------------------------------------

export interface VerifyOtpParams extends VerifyOtpInput {
  tenantId: string;
  /** Nome do primeiro acesso, vindo do cookie pendente do adaptador. */
  pendingName?: string | null;
  ip?: string | null;
  /** Injetável para teste de expiração/tentativas. */
  now?: Date;
}

export interface VerifyOtpSuccess {
  ok: true;
  userId: string;
  role: Role;
  isNewUser: boolean;
}

export type VerifyOtpOutcome = VerifyOtpSuccess | Extract<VerifyOtpResult, { ok: false }>;

type VerifyOtpDbOutcome =
  | { kind: 'ok'; userId: string; role: Role; isNewUser: boolean }
  | { kind: 'invalid_code'; remainingAttempts: number }
  | { kind: 'expired' }
  | { kind: 'too_many' }
  | { kind: 'rate_limited' };

export async function verifyOtp(params: VerifyOtpParams): Promise<VerifyOtpOutcome> {
  const phone = typeof params.phone === 'string' ? params.phone.trim() : '';
  const code = typeof params.code === 'string' ? params.code.trim() : '';
  if (!isE164(phone) || !OTP_CODE_PATTERN.test(code)) {
    return verifyOtpFailure('INVALID_CODE');
  }

  const now = params.now ?? new Date();
  const ip = params.ip ?? null;
  const pendingName = typeof params.pendingName === 'string' ? params.pendingName.trim() : '';

  const verifyIpKey = ip ? `otp:verify:ip:${ip}` : null;
  const verifyPhoneKey = `otp:verify:phone:${phone}`;

  const outcome = await forTenant(params.tenantId, async (tx): Promise<VerifyOtpDbOutcome> => {
    await lockPhone(tx, phone);

    // Os contadores de verify contam SÓ tentativas que falham (fase-1 §2): aqui
    // só se confere o teto, o incremento acontece quando o resultado não é ok.
    if (verifyIpKey) {
      const ipState = await peekCounter(tx, verifyIpKey, OTP_RATE_LIMITS.verifyPerIp.max, now);
      if (!ipState.allowed) {
        logRateLimit('verify-ip', verifyIpKey);
        return { kind: 'rate_limited' };
      }
    }
    const phoneState = await peekCounter(
      tx,
      verifyPhoneKey,
      OTP_RATE_LIMITS.verifyPerPhone.max,
      now,
    );
    if (!phoneState.allowed) {
      logRateLimit('verify-phone', verifyPhoneKey);
      return { kind: 'rate_limited' };
    }

    const result = await (async (): Promise<VerifyOtpDbOutcome> => {
      const challenge = await tx.otpChallenge.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' },
      });
      if (!challenge) return { kind: 'expired' };

      if (challenge.consumedAt) {
        // Consumido por uso ou por esgotar tentativas: as duas leituras dão a
        // mensagem certa para o usuário sem permitir novo uso.
        return challenge.attempts >= OTP_MAX_ATTEMPTS ? { kind: 'too_many' } : { kind: 'expired' };
      }
      if (challenge.expiresAt.getTime() <= now.getTime()) {
        await tx.otpChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: now },
        });
        return { kind: 'expired' };
      }
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await tx.otpChallenge.updateMany({
          where: { id: challenge.id, consumedAt: null },
          data: { consumedAt: now },
        });
        return { kind: 'too_many' };
      }

      if (!otpCodesMatch(code, challenge.codeHash)) {
        // Código de um desafio ANTERIOR (invalidação por reenvio) não deve
        // gastar tentativa do desafio atual: é "expirado", não "errado".
        const stale = await tx.otpChallenge.findMany({
          where: {
            phone,
            id: { not: challenge.id },
            consumedAt: { not: null },
            expiresAt: { gt: now },
          },
          select: { codeHash: true },
        });
        if (stale.some((candidate) => otpCodesMatch(code, candidate.codeHash))) {
          return { kind: 'expired' };
        }

        const attempts = challenge.attempts + 1;
        if (attempts >= OTP_MAX_ATTEMPTS) {
          await tx.otpChallenge.update({
            where: { id: challenge.id },
            data: { attempts, consumedAt: now },
          });
          return { kind: 'too_many' };
        }
        await tx.otpChallenge.update({ where: { id: challenge.id }, data: { attempts } });
        return { kind: 'invalid_code', remainingAttempts: OTP_MAX_ATTEMPTS - attempts };
      }

      // Uso único sob concorrência: quem consumir primeiro vence.
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: now },
      });
      if (consumed.count === 0) return { kind: 'expired' };

      // Primeiro acesso: pessoa é global, papel é por tenant (plano §4). O
      // vínculo usa a MESMA transação (ensureMembership da F1.3 com `tx`):
      // uma regra só, atômica com o consumo do desafio.
      let user = await tx.user.findUnique({ where: { phone }, select: { id: true } });
      const isNewUser = user === null;
      if (!user) {
        const displayName =
          pendingName.length > 0 ? pendingName.slice(0, OTP_MAX_NAME_LENGTH) : phone;
        user = await tx.user.create({
          data: { phone, name: displayName },
          select: { id: true },
        });
      }

      const member = await ensureMembership(params.tenantId, user.id, { tx });
      return { kind: 'ok', userId: user.id, role: member.role, isNewUser };
    })();

    if (result.kind !== 'ok') {
      if (verifyIpKey) {
        await bumpCounter(
          tx,
          verifyIpKey,
          OTP_RATE_LIMITS.verifyPerIp.max,
          OTP_RATE_LIMITS.verifyPerIp.windowSeconds,
          now,
        );
      }
      await bumpCounter(
        tx,
        verifyPhoneKey,
        OTP_RATE_LIMITS.verifyPerPhone.max,
        OTP_RATE_LIMITS.verifyPerPhone.windowSeconds,
        now,
      );
    }

    return result;
  });

  switch (outcome.kind) {
    case 'ok':
      return {
        ok: true,
        userId: outcome.userId,
        role: outcome.role,
        isNewUser: outcome.isNewUser,
      };
    case 'invalid_code':
      return verifyOtpFailure('INVALID_CODE', outcome.remainingAttempts);
    case 'expired':
      return verifyOtpFailure('EXPIRED');
    case 'too_many':
      return verifyOtpFailure('TOO_MANY_ATTEMPTS');
    case 'rate_limited':
      return verifyOtpFailure('RATE_LIMITED');
  }
}
