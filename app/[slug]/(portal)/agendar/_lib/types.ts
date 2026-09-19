import type { PaymentMode } from '@prisma/client';

/**
 * Contratos do fluxo de agendamento (F3.3). Servem de fronteira entre o
 * servidor (páginas, server actions e o domínio em `_lib`) e os componentes de
 * cliente: tudo aqui é serializável — datas viram ISO 8601, nunca `Date`.
 */

export interface ServiceSummary {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
  paymentMode: PaymentMode;
  depositCents: number | null;
  depositPercent: number | null;
}

export interface StaffSummary {
  id: string;
  name: string;
}

/** Dia ofertado no seletor, já rotulado no fuso do tenant. */
export interface DayOption {
  /** "YYYY-MM-DD" no fuso do tenant. */
  date: string;
  /** Rótulo curto do dia da semana (ex.: "sáb"). */
  weekday: string;
  /** Rótulo "dd/mm". */
  dayMonth: string;
}

export interface BookingOptions {
  service: ServiceSummary;
  staff: StaffSummary[];
  timezone: string;
  dates: DayOption[];
}

export interface SlotOption {
  /** Instante UTC do início do slot, em ISO 8601. */
  value: string;
  /** Hora local do tenant, ex.: "10:30". */
  label: string;
}

export interface HoldInfo {
  holdId: string;
  service: ServiceSummary;
  staffName: string;
  /** Instante UTC do início, ISO 8601. */
  startsAt: string;
  /** Instante UTC em que o hold expira, ISO 8601. */
  expiresAt: string;
  /** Data e hora locais do tenant, prontas para exibição. */
  startsAtLabel: string;
  /**
   * `true` quando quem criou o hold já tem sessão no tenant: a etapa de OTP é
   * pulada e a confirmação é direta. É o que permite ao cliente retomar o fluxo
   * depois de o hold expirar sem refazer o código.
   */
  authenticated: boolean;
}

export interface ConfirmedInfo {
  hold: HoldInfo;
  /**
   * `true` quando a confirmação já havia acontecido (clique duplo/conexão
   * ruim) e o cliente recebeu o MESMO agendamento em vez de um erro.
   */
  alreadyConfirmed: boolean;
}

export type BookingErrorCode =
  | 'INVALID_INPUT'
  | 'TENANT_UNAVAILABLE'
  | 'SERVICE_NOT_FOUND'
  | 'SLOT_UNAVAILABLE'
  | 'BOOKING_NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'CONFLICT';

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: BookingErrorCode; message: string };
