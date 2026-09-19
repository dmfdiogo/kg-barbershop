import type { BookingStatus, PaymentMode } from '@prisma/client';

/**
 * Contratos da área do cliente (F3.4). Tudo aqui é serializável — datas viram
 * ISO 8601, nunca `Date` — porque cruza a fronteira Server Component →
 * Client Component. Mesma disciplina do fluxo de agendamento (F3.3).
 */

/** Dia ofertado no seletor de remarcação, já rotulado no fuso do tenant. */
export interface AccountDay {
  /** "YYYY-MM-DD" no fuso do tenant. */
  date: string;
  weekday: string;
  dayMonth: string;
}

export interface AccountBooking {
  id: string;
  serviceId: string;
  staffId: string;
  serviceName: string;
  staffName: string;
  /** Instante UTC do início, ISO 8601. */
  startsAt: string;
  /** Data e hora locais do tenant, prontas para exibição. */
  startsAtLabel: string;
  durationMin: number;
  priceCents: number;
  paymentMode: PaymentMode;
  status: BookingStatus;
  /**
   * `true` quando o cliente ainda pode cancelar/remarcar pela janela do tenant.
   * `false` NÃO faz o botão sumir: a UI explica a política (decisão de produto).
   */
  canManage: boolean;
}

export interface AccountData {
  timezone: string;
  dates: AccountDay[];
  upcoming: AccountBooking[];
  history: AccountBooking[];
  /** `Tenant.cancellationWindowHours`, exibido na explicação da política. */
  cancellationWindowHours: number;
}

export interface AccountSlot {
  /** Instante UTC do início, ISO 8601. */
  value: string;
  /** Hora local do tenant, "HH:mm". */
  label: string;
}

export type AccountErrorCode =
  | 'INVALID_INPUT'
  | 'TENANT_UNAVAILABLE'
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'CANCELLATION_WINDOW_CLOSED'
  | 'SLOT_UNAVAILABLE'
  | 'SERVICE_NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'CONFLICT';

export type AccountActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: AccountErrorCode; message: string };
