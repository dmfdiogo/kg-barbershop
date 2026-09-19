import { describe, expect, it } from 'vitest';
import {
  annualizedContractedCents,
  monthlyRecurringCents,
  summarizeRecurring,
  type RecurringMembershipRow,
} from '@/app/(dashboard)/painel/clube/relatorios/_lib/reports';

/**
 * Normalização de ciclo para o MRR do clube (tarefa F5.3). Puro, sem Postgres:
 * é a regra que decide o número que o dono lê, e ela tem duas armadilhas que
 * este teste fixa —
 *
 *   1. o preço é o CONTRATADO de cada assinatura, não o preço corrente do plano
 *      (o seed tem plano a R$ 79,00 e assinante a R$ 69,00);
 *   2. ciclos diferentes não se somam crus: anual e mensal viram o mesmo
 *      equivalente mensal antes de somar.
 */

function row(overrides: Partial<RecurringMembershipRow> = {}): RecurringMembershipRow {
  return {
    status: 'ACTIVE',
    contractedPriceCents: 6900,
    cycle: 'MONTHLY',
    ...overrides,
  };
}

describe('normalização de ciclo do MRR', () => {
  it('converte cada ciclo no equivalente anual em centavos', () => {
    expect(annualizedContractedCents(6900, 'MONTHLY')).toBe(82800);
    expect(annualizedContractedCents(120000, 'YEARLY')).toBe(120000);
    expect(annualizedContractedCents(21000, 'QUARTERLY')).toBe(84000);
    expect(annualizedContractedCents(42000, 'SEMIANNUALLY')).toBe(84000);
    expect(annualizedContractedCents(20000, 'BIWEEKLY')).toBe(520000);
    expect(annualizedContractedCents(10000, 'WEEKLY')).toBe(520000);
  });

  it('volta do anual para o mensal arredondando uma vez', () => {
    expect(monthlyRecurringCents(82800)).toBe(6900);
    expect(monthlyRecurringCents(120000)).toBe(10000);
    // 100001/12 = 8333,41... arredonda para 8333.
    expect(monthlyRecurringCents(100001)).toBe(8333);
  });
});

describe('resumo de assinaturas', () => {
  it('usa o preço contratado, nunca o preço do plano (caso do seed)', () => {
    // O plano custa R$ 79,00 hoje, mas a assinante contratou por R$ 69,00.
    // Somar o preço do plano daria 7900 — errado.
    const summary = summarizeRecurring([row({ contractedPriceCents: 6900, cycle: 'MONTHLY' })]);
    expect(summary.mrrCents).toBe(6900);
    expect(summary.mrrCents).not.toBe(7900);
    expect(summary.activeSubscribers).toBe(1);
    expect(summary.pastDueSubscribers).toBe(0);
  });

  it('normaliza ciclos diferentes antes de somar', () => {
    const summary = summarizeRecurring([
      row({ contractedPriceCents: 6900, cycle: 'MONTHLY' }),
      row({ contractedPriceCents: 120000, cycle: 'YEARLY' }),
    ]);
    // (69,00×12 + 1200,00) / 12 = 169,00.
    expect(summary.mrrCents).toBe(16900);
    expect(summary.activeSubscribers).toBe(2);
  });

  it('inadimplente é PAST_DUE e não entra no MRR', () => {
    const summary = summarizeRecurring([
      row({ status: 'ACTIVE', contractedPriceCents: 6900 }),
      row({ status: 'PAST_DUE', contractedPriceCents: 9900 }),
    ]);
    expect(summary.activeSubscribers).toBe(1);
    expect(summary.pastDueSubscribers).toBe(1);
    expect(summary.mrrCents).toBe(6900);
  });

  it('cancelado e expirado não contam como assinante nem MRR', () => {
    const summary = summarizeRecurring([
      row({ status: 'CANCELED' }),
      row({ status: 'EXPIRED' }),
    ]);
    expect(summary).toEqual({ activeSubscribers: 0, pastDueSubscribers: 0, mrrCents: 0 });
  });
});
