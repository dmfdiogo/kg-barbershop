import type {
  BookingStatus,
  KycStatus,
  SubscriptionStatus,
  TenantStatus,
} from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { BILLING_PLANS, type BillingPlanCode } from '@/lib/billing/plans';

/**
 * Rótulos e formatação das telas do painel (tarefa F7.3). Sem cor literal: os
 * tons são nomes semânticos resolvidos em classes de token de tema, o mesmo
 * padrão de `app/(dashboard)/painel/financeiro/conta`.
 */

export type Tone = 'success' | 'warning' | 'danger' | 'muted';

export const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
  warning: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]',
  muted: 'bg-[var(--color-muted)] text-[var(--color-secondary)]',
};

export interface StatusLabel {
  label: string;
  tone: Tone;
}

export const TENANT_STATUS_LABEL: Record<TenantStatus, StatusLabel> = {
  TRIAL: { label: 'Trial', tone: 'warning' },
  ACTIVE: { label: 'Ativo', tone: 'success' },
  PAST_DUE: { label: 'Inadimplente', tone: 'danger' },
  SUSPENDED: { label: 'Suspenso', tone: 'danger' },
  CANCELED: { label: 'Encerrado', tone: 'muted' },
};

export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, StatusLabel> = {
  TRIALING: { label: 'Em trial', tone: 'warning' },
  ACTIVE: { label: 'Ativa', tone: 'success' },
  PAST_DUE: { label: 'Em atraso', tone: 'danger' },
  CANCELED: { label: 'Cancelada', tone: 'muted' },
};

export const KYC_STATUS_LABEL: Record<KycStatus, StatusLabel> = {
  APPROVED: { label: 'Aprovado', tone: 'success' },
  PENDING: { label: 'Em análise', tone: 'warning' },
  REJECTED: { label: 'Recusado', tone: 'danger' },
};

/** Subconta inexistente não é KYC pendente: é conta que ainda não foi criada. */
export const NO_KYC_ACCOUNT: StatusLabel = { label: 'Não criada', tone: 'muted' };

export const BOOKING_STATUS_LABEL: Record<BookingStatus, StatusLabel> = {
  HOLD: { label: 'Reservado', tone: 'muted' },
  PENDING: { label: 'Pendente', tone: 'warning' },
  CONFIRMED: { label: 'Confirmado', tone: 'success' },
  COMPLETED: { label: 'Concluído', tone: 'success' },
  CANCELLED: { label: 'Cancelado', tone: 'danger' },
  NO_SHOW: { label: 'Não compareceu', tone: 'danger' },
};

export function planLabel(plan: BillingPlanCode | null): string {
  return plan ? BILLING_PLANS[plan].name : 'Trial';
}

/** 0..1 → "50,0%". Sem `Intl`: a vírgula é o decimal pt-BR em toda a interface. */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace('.', ',')}%`;
}

export function formatDateTime(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'dd/MM/yyyy HH:mm');
}

export function formatDate(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'dd/MM/yyyy');
}
