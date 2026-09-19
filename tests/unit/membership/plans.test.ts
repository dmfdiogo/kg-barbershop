import { describe, expect, it } from 'vitest';
import {
  MEMBERSHIP_CYCLES,
  MEMBERSHIP_CYCLE_LABELS,
  validateMembershipPlanForm,
} from '@/lib/membership/plans';

/**
 * Validação do formulário de plano (tarefa F5.0).
 *
 * A regra que mais importa aqui é a de origem do benefício: o conjunto de
 * serviços permitidos é carregado da transação escopada, e um id de OUTRO
 * salão não passa. É a camada de aplicação do isolamento; a RLS cobre por cima.
 */

const ALLOWED = new Set(['svc-corte', 'svc-barba']);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Clube 2 cortes/mês',
    price: '79,00',
    cycle: 'MONTHLY',
    active: true,
    benefits: [{ serviceId: 'svc-corte', quantityPerCycle: '2' }],
    ...overrides,
  };
}

describe('validateMembershipPlanForm', () => {
  it('converte o preço para centavos e normaliza a entrada', () => {
    const result = validateMembershipPlanForm(baseInput(), ALLOWED);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.priceCents).toBe(7900);
    expect(result.value.cycle).toBe('MONTHLY');
    expect(result.value.active).toBe(true);
    expect(result.value.benefits).toEqual([{ serviceId: 'svc-corte', quantityPerCycle: 2 }]);
  });

  it('expoe os ciclos com rótulo em pt-BR', () => {
    expect(MEMBERSHIP_CYCLES).toContain('MONTHLY');
    expect(MEMBERSHIP_CYCLE_LABELS.MONTHLY).toBe('Mensal');
    expect(MEMBERSHIP_CYCLE_LABELS.YEARLY).toBe('Anual');
  });

  it('recusa nome curto, preço inválido e ciclo desconhecido', () => {
    expect(validateMembershipPlanForm(baseInput({ name: 'A' }), ALLOWED).ok).toBe(false);
    expect(validateMembershipPlanForm(baseInput({ price: '0' }), ALLOWED).ok).toBe(false);
    expect(validateMembershipPlanForm(baseInput({ price: 'abc' }), ALLOWED).ok).toBe(false);
    expect(validateMembershipPlanForm(baseInput({ cycle: 'DAILY' }), ALLOWED).ok).toBe(false);
  });

  it('recusa benefício apontando para serviço de outro tenant', () => {
    const result = validateMembershipPlanForm(
      baseInput({ benefits: [{ serviceId: 'svc-do-outro-salao', quantityPerCycle: '1' }] }),
      ALLOWED,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.benefits).toMatch(/estabelecimento/i);
  });

  it('recusa quantidade fora da faixa e serviço repetido', () => {
    const foraDaFaixa = validateMembershipPlanForm(
      baseInput({ benefits: [{ serviceId: 'svc-corte', quantityPerCycle: '0' }] }),
      ALLOWED,
    );
    expect(foraDaFaixa.ok).toBe(false);

    const repetido = validateMembershipPlanForm(
      baseInput({
        benefits: [
          { serviceId: 'svc-corte', quantityPerCycle: '1' },
          { serviceId: 'svc-corte', quantityPerCycle: '3' },
        ],
      }),
      ALLOWED,
    );
    expect(repetido.ok).toBe(false);
    if (!repetido.ok) {
      expect(repetido.fieldErrors.benefits).toMatch(/uma vez/i);
    }
  });

  it('aceita plano sem benefícios (eles podem ser adicionados depois)', () => {
    const result = validateMembershipPlanForm(baseInput({ benefits: [] }), ALLOWED);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.benefits).toEqual([]);
  });
});
