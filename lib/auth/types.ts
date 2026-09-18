import type { MemberRole } from '@prisma/client';

/**
 * Contratos de autenticação da F1.0 (tronco da fase 1).
 *
 * Tipos aqui não conhecem banco nem request: são a superfície que F1.1
 * (implementação do OTP), F1.2 (telas) e F1.3 (membership) compilam contra sem
 * se enxergar.
 */

/**
 * Papel dentro de um tenant. É o enum `MemberRole` do schema, reexportado como
 * tipo para não existirem duas listas que possam divergir.
 */
export type Role = MemberRole;

export const ROLES = ['OWNER', 'STAFF', 'CUSTOMER'] as const satisfies readonly Role[];

/**
 * Sessão de usuário. NÃO carrega papel: o papel pertence ao par (usuário,
 * tenant) e é lido de `TenantMember` a cada requisição (fase-1, armadilha
 * "papel em token"). A mesma pessoa pode ser OWNER no salão A e CUSTOMER no B.
 */
export interface Session {
  userId: string;
  /**
   * Tenant escolhido para rotas sem tenant no caminho (ex.: `/painel`). Serve
   * para a troca de contexto entre tenants (F1.3) e nunca é usado como
   * identidade de papel sem conferir `TenantMember`.
   */
  activeTenantId: string | null;
  issuedAt: Date;
  expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Server actions de autenticação (contrato consumido pela F1.2)
// ---------------------------------------------------------------------------

export interface RequestOtpInput {
  /** Nome informado no primeiro acesso; ignorado se o usuário já existe. */
  name: string;
  /** WhatsApp em E.164 (ex.: +5548999999999). */
  phone: string;
}

export type RequestOtpErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PHONE'
  | 'COOLDOWN'
  | 'RATE_LIMITED'
  | 'TENANT_UNAVAILABLE';

export type RequestOtpResult =
  | { ok: true }
  | {
      ok: false;
      code: RequestOtpErrorCode;
      /** Mensagem em pt-BR, pronta para exibição. */
      message: string;
      /** Segundos até poder reenviar (preenchido em COOLDOWN/RATE_LIMITED). */
      retryAfterSeconds?: number;
    };

export interface VerifyOtpInput {
  phone: string;
  /** Código de 6 dígitos informado pelo usuário. */
  code: string;
}

export type VerifyOtpErrorCode =
  | 'INVALID_CODE'
  | 'EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'RATE_LIMITED'
  | 'TENANT_UNAVAILABLE';

export type VerifyOtpResult =
  | { ok: true; role: Role }
  | {
      ok: false;
      code: VerifyOtpErrorCode;
      /** Mensagem em pt-BR, pronta para exibição. */
      message: string;
      /** Tentativas restantes antes de invalidar o desafio. */
      remainingAttempts?: number;
    };
