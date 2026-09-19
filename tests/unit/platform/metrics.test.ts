import { describe, expect, it } from 'vitest';
import {
  computePlatformMetrics,
  isTenantInTrial,
  type PlatformTenantRow,
} from '@/lib/platform/metrics';

/**
 * Aritmética das métricas do painel (tarefa F7.3). Pura, sem Postgres — é onde
 * as definições de MRR, churn e conversão ficam travadas por teste para que
 * ninguém "corrija" um denominador sem perceber.
 */

let seq = 0;

function row(overrides: Partial<PlatformTenantRow> = {}): PlatformTenantRow {
  seq += 1;
  return {
    id: `tenant-${seq}`,
    slug: `tenant-${seq}`,
    name: `Tenant ${seq}`,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    plan: null,
    subscriptionStatus: null,
    activeAgendas: 1,
    trialBookingsUsed: 0,
    kycStatus: null,
    ...overrides,
  };
}

describe('isTenantInTrial', () => {
  it('sem assinatura ou TRIALING está em trial', () => {
    expect(isTenantInTrial(null)).toBe(true);
    expect(isTenantInTrial(undefined)).toBe(true);
    expect(isTenantInTrial('TRIALING')).toBe(true);
  });

  it('ACTIVE, PAST_DUE e CANCELED estão fora do trial', () => {
    expect(isTenantInTrial('ACTIVE')).toBe(false);
    expect(isTenantInTrial('PAST_DUE')).toBe(false);
    expect(isTenantInTrial('CANCELED')).toBe(false);
  });
});

describe('computePlatformMetrics', () => {
  it('base vazia devolve zeros, sem NaN', () => {
    const metrics = computePlatformMetrics([]);
    expect(metrics).toMatchObject({
      mrrCents: 0,
      trialTenants: 0,
      convertedTenants: 0,
      totalTenants: 0,
    });
    expect(metrics.churnRate).toBe(0);
    expect(metrics.conversionRate).toBe(0);
    expect(Number.isNaN(metrics.churnRate)).toBe(false);
    expect(Number.isNaN(metrics.conversionRate)).toBe(false);
  });

  it('MRR soma só assinaturas ACTIVE, pelo preço do plano', () => {
    const metrics = computePlatformMetrics([
      row({ plan: 'SOLO', subscriptionStatus: 'ACTIVE' }), // 3990
      row({ plan: 'EQUIPE', subscriptionStatus: 'ACTIVE' }), // 7990
      row({ plan: 'PRO', subscriptionStatus: 'ACTIVE' }), // 13990
      row({ plan: 'PRO', subscriptionStatus: 'PAST_DUE' }), // não entra
      row({ plan: null, subscriptionStatus: null }), // trial
    ]);

    expect(metrics.mrrCents).toBe(3990 + 7990 + 13990);
    expect(metrics.activeSubscriptions).toBe(3);
    expect(metrics.pastDueSubscriptions).toBe(1);
  });

  it('trial conta assinatura ausente e TRIALING; convertidos o resto', () => {
    const metrics = computePlatformMetrics([
      row({ subscriptionStatus: null }),
      row({ subscriptionStatus: 'TRIALING', plan: 'SOLO' }),
      row({ subscriptionStatus: 'ACTIVE', plan: 'SOLO' }),
      row({ subscriptionStatus: 'CANCELED', plan: 'SOLO' }),
    ]);

    expect(metrics.trialTenants).toBe(2);
    expect(metrics.convertedTenants).toBe(2);
  });

  it('conversão = convertidos ÷ (convertidos + trial)', () => {
    const metrics = computePlatformMetrics([
      row({ subscriptionStatus: 'ACTIVE', plan: 'SOLO' }),
      row({ subscriptionStatus: null }),
      row({ subscriptionStatus: null }),
      row({ subscriptionStatus: null }),
    ]);

    // 1 convertido, 3 em trial → 25%.
    expect(metrics.conversionRate).toBeCloseTo(0.25);
  });

  it('churn olha só a base paga e ignora trial', () => {
    const metrics = computePlatformMetrics([
      row({ subscriptionStatus: 'ACTIVE', plan: 'SOLO' }),
      row({ subscriptionStatus: 'ACTIVE', plan: 'SOLO' }),
      row({ subscriptionStatus: 'PAST_DUE', plan: 'SOLO' }),
      row({ subscriptionStatus: 'CANCELED', plan: 'SOLO' }),
      // Trials não entram no denominador do churn.
      row({ subscriptionStatus: null }),
      row({ subscriptionStatus: 'TRIALING', plan: 'SOLO' }),
    ]);

    // 1 cancelada em 4 pagantes → 25%.
    expect(metrics.churnRate).toBeCloseTo(0.25);
    expect(metrics.canceledSubscriptions).toBe(1);
  });

  it('total de tenants é o tamanho da lista', () => {
    const metrics = computePlatformMetrics([row(), row(), row()]);
    expect(metrics.totalTenants).toBe(3);
  });
});
