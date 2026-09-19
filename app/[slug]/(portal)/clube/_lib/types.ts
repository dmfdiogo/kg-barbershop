import type { MembershipCycle } from '@/lib/membership/plans';
import type { MembershipStatus } from '@/lib/membership/subscription';

/**
 * Contratos das visões do clube do cliente (tarefa F5.3).
 *
 * Tudo serializável — datas viram ISO/rótulo, nunca `Date` — porque cruza a
 * fronteira Server Component → Client Component (o botão de cancelar). Mesma
 * disciplina de `minha-conta/_lib/types.ts`.
 */

export interface CustomerClubBenefit {
  serviceId: string;
  serviceName: string;
  /** Quanto o plano concede por ciclo. `0` quando o serviço veio só do ledger. */
  quantityPerCycle: number;
  /** Saldo atual: a SOMA do ledger append-only, nunca um contador. */
  balance: number;
}

export interface CustomerClubMembership {
  id: string;
  planName: string;
  cycle: MembershipCycle;
  status: MembershipStatus;
  contractedPriceCents: number;
  /** Fim do período pago — a data da próxima cobrança. ISO 8601 ou `null`. */
  currentPeriodEnd: string | null;
  /** Mesma data, já formatada no fuso do tenant. */
  nextChargeLabel: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
  benefits: CustomerClubBenefit[];
}

export interface CustomerClubData {
  timezone: string;
  /** Assinaturas vigentes do cliente logado: ACTIVE e PAST_DUE. */
  memberships: CustomerClubMembership[];
}

export type ClubActionErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'TENANT_UNAVAILABLE'
  | 'MEMBERSHIP_NOT_FOUND'
  | 'FORBIDDEN'
  | 'PROVIDER_ERROR'
  | 'ERROR';

export type ClubActionResult =
  | { ok: true }
  | { ok: false; code: ClubActionErrorCode; message: string };
