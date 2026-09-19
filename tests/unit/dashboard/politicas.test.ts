import { describe, expect, it } from 'vitest';
import {
  validatePoliciesForm,
  validatePortalAddress,
  NO_SHOW_TEXT_MAX,
} from '@/app/(dashboard)/painel/configuracoes/validation';
import {
  discoverNavItems,
  getDashboardNav,
} from '@/components/dashboard/nav';
import { nav as configNav } from '@/app/(dashboard)/painel/configuracoes/nav';
import { nav as inicioNav } from '@/app/(dashboard)/painel/inicio/nav';

/**
 * Validação pura de políticas e endereço do portal (tarefa F2.4).
 *
 * O slug reservado reaproveita a lista da F1.0 (`RESERVED_SLUGS`): um tenant
 * com `painel` ou `api` ficaria inacessível para sempre, então a configuração
 * precisa recusar exatamente o que o roteamento recusa.
 */

function policies(overrides: Record<string, unknown> = {}) {
  return {
    cancellationWindowHours: '24',
    minAdvanceMinutes: '0',
    maxAdvanceMinutes: '',
    noShowPolicyText: '',
    ...overrides,
  };
}

describe('validação das políticas', () => {
  it('aceita o caso padrão e normaliza texto vazio para null', () => {
    const result = validatePoliciesForm(policies());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      cancellationWindowHours: 24,
      minAdvanceMinutes: 0,
      maxAdvanceMinutes: null,
      noShowPolicyText: null,
    });
  });

  it('interpreta a antecedência máxima quando informada', () => {
    const result = validatePoliciesForm(policies({ maxAdvanceMinutes: '120' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.maxAdvanceMinutes).toBe(120);
  });

  it('recusa janela negativa e minutos não inteiros', () => {
    const result = validatePoliciesForm(
      policies({ cancellationWindowHours: '-1', minAdvanceMinutes: '1.5' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.cancellationWindowHours).toBeDefined();
    expect(result.fieldErrors.minAdvanceMinutes).toBeDefined();
  });

  it('recusa antecedência máxima menor que a mínima', () => {
    const result = validatePoliciesForm(
      policies({ minAdvanceMinutes: '120', maxAdvanceMinutes: '60' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.maxAdvanceMinutes).toBeDefined();
  });

  it('recusa política de no-show longa demais e apara o texto válido', () => {
    const tooLong = validatePoliciesForm(
      policies({ noShowPolicyText: 'a'.repeat(NO_SHOW_TEXT_MAX + 1) }),
    );
    expect(tooLong.ok).toBe(false);

    const trimmed = validatePoliciesForm(policies({ noShowPolicyText: '  aviso  ' }));
    expect(trimmed.ok).toBe(true);
    if (!trimmed.ok) return;
    expect(trimmed.value.noShowPolicyText).toBe('aviso');
  });
});

describe('validação do endereço do portal', () => {
  it('recusa slug reservado com mensagem própria', () => {
    const result = validatePortalAddress({ slug: 'painel', customDomain: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.slug).toMatch(/reservado/i);
  });

  it('recusa formato inválido e curto demais', () => {
    expect(validatePortalAddress({ slug: 'a', customDomain: null }).ok).toBe(false);
    expect(validatePortalAddress({ slug: 'Corte Bela', customDomain: null }).ok).toBe(false);
    expect(validatePortalAddress({ slug: '-corte', customDomain: null }).ok).toBe(false);
  });

  it('normaliza o slug e aceita endereço válido', () => {
    const result = validatePortalAddress({ slug: '  Bella-Corte ', customDomain: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slug).toBe('bella-corte');
  });

  it('normaliza e valida o domínio próprio', () => {
    const result = validatePortalAddress({
      slug: 'bella-corte',
      customDomain: '  www.BellaCorte.com.BR. ',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customDomain).toBe('www.bellacorte.com.br');
  });

  it('recusa domínio com esquema ou caminho', () => {
    expect(
      validatePortalAddress({ slug: 'bella-corte', customDomain: 'https://bella.com.br' }).ok,
    ).toBe(false);
    expect(
      validatePortalAddress({ slug: 'bella-corte', customDomain: 'bella.com.br/agenda' }).ok,
    ).toBe(false);
  });

  it('domínio em branco vira null', () => {
    const result = validatePortalAddress({ slug: 'bella-corte', customDomain: '   ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customDomain).toBeNull();
  });
});

describe('navegação das duas features', () => {
  it('configurações é restrita ao dono; início é de qualquer membro', () => {
    expect(configNav.href).toBe('/painel/configuracoes');
    expect(configNav.roles).toEqual(['OWNER']);
    expect(inicioNav.href).toBe('/painel/inicio');
    expect(inicioNav.roles).toBeUndefined();
  });

  it('entram no menu por descoberta', () => {
    const items = discoverNavItems();
    expect(items.some((item) => item.href === '/painel/configuracoes')).toBe(true);
    expect(items.some((item) => item.href === '/painel/inicio')).toBe(true);
  });

  it('o Staff vê início e não vê configurações', () => {
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/inicio')).toBe(true);
    expect(getDashboardNav('STAFF').some((item) => item.href === '/painel/configuracoes')).toBe(
      false,
    );
  });
});
