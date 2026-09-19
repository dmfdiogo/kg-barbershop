import type { BookingSource, BookingStatus, MemberRole } from '@prisma/client';

/**
 * Contratos da agenda do painel (tarefa F3.5, spec §2.3).
 *
 * Módulo seguro para o bundle do cliente: os enums do Prisma entram apenas como
 * TIPO (apagados na compilação), então nenhum valor do Prisma Client vaza para o
 * navegador.
 */

export type AgendaViewMode = 'day' | 'week';

/**
 * Status exibido na área do prestador. É derivado, não é o `BookingStatus`:
 * "Pago" combina `CONFIRMED` com um pagamento `PAID`; "Pendente" cobre HOLD e
 * PENDING. Os demais espelham o status do agendamento.
 */
export type AgendaDisplayStatus =
  | 'CONFIRMED'
  | 'PAID'
  | 'PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

export interface AgendaBookingView {
  id: string;
  status: BookingStatus;
  displayStatus: AgendaDisplayStatus;
  /** ISO 8601 UTC. */
  startsAt: string;
  endsAt: string;
  staffId: string;
  staffName: string;
  customerName: string;
  serviceName: string;
  priceCents: number;
  source: BookingSource;
  completedAt: string | null;
  noShowAt: string | null;
  paymentStatus: 'PAID' | 'PENDING' | null;
}

/**
 * Escopo de visão resolvido no servidor. `filterStaffId` nulo só existe para o
 * OWNER e significa "todos os profissionais do tenant". O STAFF nunca tem um
 * escopo nulo: `filterStaffId` é sempre o próprio `StaffProfile.id`.
 */
export interface AgendaScope {
  role: MemberRole;
  /** `StaffProfile.id` do próprio usuário quando STAFF; nulo para OWNER. */
  ownStaffId: string | null;
  /** Filtro efetivo; nulo = todos (apenas OWNER). */
  filterStaffId: string | null;
}

export interface AgendaStaffOption {
  id: string;
  name: string;
  active: boolean;
}

export interface AgendaServiceOption {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  active: boolean;
}

export type AgendaErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'SLOT_UNAVAILABLE'
  | 'INVALID_STATE'
  | 'FORBIDDEN';

export type AgendaField = 'staffId' | 'serviceId' | 'customerName' | 'customerPhone' | 'startsAt';
export type AgendaFieldErrors = Partial<Record<AgendaField, string>>;

export interface AgendaFailure {
  ok: false;
  code: AgendaErrorCode;
  message: string;
  fieldErrors?: AgendaFieldErrors;
}

export interface WalkInFormInput {
  staffId?: unknown;
  serviceId?: unknown;
  customerName?: unknown;
  customerPhone?: unknown;
  /** "YYYY-MM-DDTHH:mm" no fuso do tenant. */
  startsAtLocal?: unknown;
}

export interface ValidatedWalkIn {
  staffId: string;
  serviceId: string;
  customerName: string;
  customerPhone: string;
  startsAt: Date;
}

export type BookingStampResult = { ok: true } | AgendaFailure;
export type WalkInResult = { ok: true; booking: AgendaBookingView } | AgendaFailure;
