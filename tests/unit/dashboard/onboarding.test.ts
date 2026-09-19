import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEP_ORDER,
  firstIncompleteStep,
  isOnboardingStep,
  stepNumber,
  stepRoute,
} from '@/app/(dashboard)/painel/onboarding/steps';
import { validateEstablishment } from '@/app/(dashboard)/painel/onboarding/validation';
import { discoverNavItems, getDashboardNav } from '@/components/dashboard/nav';

/**
 * Regras puras do onboarding (tarefa F2.5): a resolução do próximo passo é o
 * que faz "voltar e retomar" funcionar, então é testada sem banco.
 */
describe('passos do onboarding', () => {
  it('sem passos concluídos, começa pelo estabelecimento', () => {
    expect(firstIncompleteStep([])).toBe('ESTABLISHMENT');
  });

  it('pula os passos já concluídos, na ordem canônica', () => {
    expect(firstIncompleteStep(['ESTABLISHMENT'])).toBe('HOURS');
    expect(firstIncompleteStep(['ESTABLISHMENT', 'HOURS'])).toBe('SERVICE');
    expect(firstIncompleteStep(['ESTABLISHMENT', 'HOURS', 'SERVICE'])).toBe('PORTAL');
  });

  it('não se importa com a ordem de escrita dos passos', () => {
    expect(firstIncompleteStep(['SERVICE', 'ESTABLISHMENT'])).toBe('HOURS');
  });

  it('todos concluídos devolve null', () => {
    expect(firstIncompleteStep([...ONBOARDING_STEP_ORDER])).toBeNull();
  });

  it('mapeia rota e número do passo', () => {
    expect(stepRoute('ESTABLISHMENT')).toBe('/painel/onboarding/estabelecimento');
    expect(stepRoute('PORTAL')).toBe('/painel/onboarding/portal');
    expect(stepNumber('SERVICE')).toBe(3);
  });

  it('reconhece apenas passos válidos', () => {
    expect(isOnboardingStep('HOURS')).toBe(true);
    expect(isOnboardingStep('DONE')).toBe(false);
    expect(isOnboardingStep(42)).toBe(false);
  });
});

describe('validação do estabelecimento', () => {
  it('aceita e normaliza CPF/CNPJ com pontuação', () => {
    const result = validateEstablishment({
      name: '  Barbearia do Carlos  ',
      document: '12.345.678/0001-90',
      pixKey: 'carlos@exemplo.com.br',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe('Barbearia do Carlos');
      expect(result.value.document).toBe('12345678000190');
      expect(result.value.pixKey).toBe('carlos@exemplo.com.br');
    }
  });

  it('recusa documento com tamanho diferente de CPF/CNPJ', () => {
    const result = validateEstablishment({
      name: 'Salão',
      document: '123',
      pixKey: 'chave',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.document).toMatch(/CPF/);
  });

  it('recusa chave Pix vazia e nome curto', () => {
    const result = validateEstablishment({ name: 'S', document: '12345678901', pixKey: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.name).toBeTruthy();
      expect(result.fieldErrors.pixKey).toBeTruthy();
    }
  });
});

describe('onboarding no menu do painel', () => {
  it('aparece por descoberta e só o dono vê', () => {
    expect(discoverNavItems().some((item) => item.href === '/painel/onboarding')).toBe(true);
    expect(getDashboardNav('OWNER').some((item) => item.href === '/painel/onboarding')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/onboarding')).toBe(false);
  });
});
