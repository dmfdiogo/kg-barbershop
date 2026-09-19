// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLANS,
  BILLING_PLAN_CODES,
  getBillingPlan,
  isBillingPlanCode,
  nextUpgrade,
  planDirection,
  planRank,
  upgradeOptions,
} from '@/lib/billing/plans';

/**
 * Configuração de planos (F7.0). Estes números são produto, não estilo:
 * qualquer mudança aqui tem de ser deliberada e visível na suíte.
 */
describe('catálogo de planos', () => {
  it('tem os preços e limites da spec §6.1, em centavos', () => {
    expect(getBillingPlan('SOLO')).toMatchObject({
      priceCents: 3990,
      agendaLimit: 1,
      branding: false,
      customDomain: false,
    });
    expect(getBillingPlan('EQUIPE')).toMatchObject({
      priceCents: 7990,
      agendaLimit: 4,
      branding: true,
      customDomain: false,
    });
    expect(getBillingPlan('PRO')).toMatchObject({
      priceCents: 13990,
      agendaLimit: null,
      branding: true,
      customDomain: true,
    });
  });

  it('mantém a chave de cada plano coerente com o código', () => {
    for (const code of BILLING_PLAN_CODES) {
      expect(BILLING_PLANS[code].code).toBe(code);
    }
  });

  it('valida o código do plano', () => {
    expect(isBillingPlanCode('PRO')).toBe(true);
    expect(isBillingPlanCode('ENTERPRISE')).toBe(false);
    expect(isBillingPlanCode(null)).toBe(false);
  });

  it('ordena planos e classifica upgrade × downgrade', () => {
    expect(planRank('SOLO')).toBeLessThan(planRank('EQUIPE'));
    expect(planRank('EQUIPE')).toBeLessThan(planRank('PRO'));

    expect(planDirection(null, 'SOLO')).toBe('UPGRADE');
    expect(planDirection('SOLO', 'PRO')).toBe('UPGRADE');
    expect(planDirection('PRO', 'SOLO')).toBe('DOWNGRADE');
    expect(planDirection('EQUIPE', 'EQUIPE')).toBe('SAME');
  });

  it('oferece o próximo degrau de capacidade para o upgrade', () => {
    expect(nextUpgrade('SOLO')?.code).toBe('EQUIPE');
    expect(nextUpgrade('EQUIPE')?.code).toBe('PRO');
    expect(nextUpgrade(null)?.code).toBe('SOLO');
    expect(nextUpgrade('PRO')).toBeUndefined();

    expect(upgradeOptions('SOLO').map((plan) => plan.code)).toEqual(['EQUIPE', 'PRO']);
  });
});
