import type { BillingPlanDefinition } from '@/lib/billing/plans';
import type { BillingSubscriptionStatus } from '@/lib/billing/types';
import { formatCents } from '@/lib/money';
import type { SubscriptionPhase } from './overview';

/**
 * Texto e formatação da tela de assinatura (tarefa F8.0-B). Sem cor literal:
 * os tons saem de tokens CSS, nunca de hex/rgb.
 */

export interface StatusTone {
  label: string;
  className: string;
}

const TONE_MUTED = 'bg-[var(--color-muted)] text-[var(--color-secondary)]';
const TONE_SUCCESS = 'bg-[var(--color-success-soft)] text-[var(--color-success)]';
const TONE_WARNING = 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]';
const TONE_DANGER = 'bg-[var(--color-danger-soft)] text-[var(--color-danger)]';

const PHASE_TONES: Record<SubscriptionPhase, StatusTone> = {
  TRIAL: { label: 'Período de teste', className: TONE_WARNING },
  AWAITING: { label: 'Aguardando confirmação', className: TONE_WARNING },
  TRIALING: { label: 'Em teste', className: TONE_WARNING },
  ACTIVE: { label: 'Ativa', className: TONE_SUCCESS },
  PAST_DUE: { label: 'Em atraso', className: TONE_DANGER },
  CANCELED: { label: 'Cancelada', className: TONE_MUTED },
};

export function phaseTone(phase: SubscriptionPhase): StatusTone {
  return PHASE_TONES[phase];
}

export const SUBSCRIPTION_STATUS_LABELS: Record<BillingSubscriptionStatus, string> = {
  TRIALING: 'Em teste',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  CANCELED: 'Cancelada',
};

/**
 * O que cada plano permite, derivado de `BILLING_PLANS` e do que a spec §6.1
 * promete a todos os planos. O limite de agendas vem do catálogo; os demais
 * itens são capacidades transversais (agenda e lembretes existem desde as fases
 * 3 e 6). Nada aqui introduz limite que o servidor não faça valer.
 */
export function planFeatures(plan: BillingPlanDefinition): string[] {
  const features: string[] = [
    plan.agendaLimit === null
      ? 'Agendas ilimitadas'
      : plan.agendaLimit === 1
        ? '1 agenda ativa'
        : `Até ${plan.agendaLimit} agendas ativas`,
    'Agendamentos ilimitados',
    'Lembretes automáticos no WhatsApp',
    'Recebimento via Pix na subconta',
  ];
  if (plan.branding) features.push('Logo e cores personalizadas no portal');
  if (plan.customDomain) features.push('Domínio próprio');
  return features;
}

/** "R$ 39,90/mês" — o preço de catálogo é mensal em todos os planos. */
export function planPriceLabel(priceCents: number): string {
  return `${formatCents(priceCents)}/mês`;
}

/**
 * Data de cobrança no fuso do tenant. `timestamptz` no banco é UTC; exibir no
 * fuso do salão evita a data "pular" um dia perto da meia-noite (mesmo cuidado
 * do invariante de tempo do projeto).
 */
export function formatBillingDate(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: timezone,
  }).format(instant);
}
