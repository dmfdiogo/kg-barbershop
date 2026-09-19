import type { PaymentMode as PrismaPaymentMode } from '@prisma/client';

/**
 * Contratos do catálogo de serviços (tarefa F2.1).
 *
 * Este módulo é seguro para o bundle do cliente: importa o enum do Prisma
 * apenas como TIPO (apagado na compilação), então nenhum valor do Prisma Client
 * vaza para o navegador. A lista `PAYMENT_MODES` existe para validação e para
 * os `<select>` do formulário sem duplicar o enum em dois lugares.
 */

export type PaymentMode = PrismaPaymentMode;

/** Ordem escolhida para o formulário; o rótulo em pt-BR fica na UI. */
export const PAYMENT_MODES = ['ON_SITE', 'DEPOSIT', 'FULL_PREPAID'] as const;

export type DepositMode = 'NONE' | 'CENTS' | 'PERCENT';

export interface ServiceView {
  id: string;
  name: string;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
  paymentMode: PaymentMode;
  depositCents: number | null;
  depositPercent: number | null;
  active: boolean;
  /** Ids dos `StaffProfile` habilitados a executar o serviço. */
  staffIds: string[];
}

export interface StaffOption {
  id: string;
  name: string;
  active: boolean;
}

/**
 * Entrada crua do formulário. Preço e sinal chegam como TEXTO de propósito: a
 * conversão para centavos acontece uma única vez, no servidor, por
 * `lib/catalog/money.ts` — nunca por `parseFloat`.
 */
export interface ServiceFormInput {
  name?: unknown;
  durationMin?: unknown;
  bufferMin?: unknown;
  price?: unknown;
  paymentMode?: unknown;
  depositMode?: unknown;
  depositValue?: unknown;
  staffIds?: unknown;
  active?: unknown;
}

export interface ValidatedService {
  name: string;
  durationMin: number;
  bufferMin: number;
  priceCents: number;
  paymentMode: PaymentMode;
  depositCents: number | null;
  depositPercent: number | null;
  active: boolean;
  staffIds: string[];
}

export type ServiceField =
  | 'name'
  | 'durationMin'
  | 'bufferMin'
  | 'price'
  | 'paymentMode'
  | 'deposit';

export type ServiceFieldErrors = Partial<Record<ServiceField, string>>;

export type ServiceValidationResult =
  | { ok: true; value: ValidatedService }
  | { ok: false; fieldErrors: ServiceFieldErrors };

export type ServiceActionErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'HAS_FUTURE_BOOKINGS'
  | 'HAS_HISTORY'
  | 'ERROR';

export type ServiceActionResult =
  | { ok: true; service?: ServiceView; deactivated?: boolean }
  | {
      ok: false;
      code: ServiceActionErrorCode;
      message: string;
      fieldErrors?: ServiceFieldErrors;
      /** Quantos agendamentos futuros bloqueiam a exclusão (quando houver). */
      futureBookings?: number;
    };

/** Status que ainda ocupam a agenda — os mesmos do anti-overlap no banco. */
export const OCCUPYING_BOOKING_STATUSES = ['HOLD', 'PENDING', 'CONFIRMED'] as const;

export type ServiceDeletionAssessment =
  | { canDelete: true; totalBookings: 0; futureBookings: 0 }
  | {
      canDelete: false;
      code: 'HAS_FUTURE_BOOKINGS' | 'HAS_HISTORY';
      totalBookings: number;
      futureBookings: number;
    };

export type ServiceDeletionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'HAS_FUTURE_BOOKINGS' | 'HAS_HISTORY';
      totalBookings: number;
      futureBookings: number;
    };
