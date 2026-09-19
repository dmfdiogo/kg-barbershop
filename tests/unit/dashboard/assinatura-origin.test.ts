import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteUrl, requestOrigin } from '@/app/(dashboard)/painel/assinatura/_lib/origin';

/**
 * A URL de retorno do checkout é destino de redirecionamento para um humano
 * autenticado, logo depois de ele pagar. Montá-la a partir do header `Host`
 * seria open redirect: quem controla o header escolhe para onde o provedor
 * manda o dono. Ela sai da configuração, e só dela.
 */
describe('origem das URLs de retorno do checkout', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('vem de APP_DOMAIN, com https fora do ambiente local', () => {
    vi.stubEnv('APP_DOMAIN', 'agendex.com.br');
    expect(requestOrigin()).toBe('https://agendex.com.br');
    expect(absoluteUrl(requestOrigin()!, '/painel/assinatura?checkout=concluido')).toBe(
      'https://agendex.com.br/painel/assinatura?checkout=concluido',
    );
  });

  it('usa http só no host local', () => {
    vi.stubEnv('APP_DOMAIN', 'localhost:3000');
    expect(requestOrigin()).toBe('http://localhost:3000');
  });

  it('sem configuração em produção, recusa em vez de adivinhar', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_DOMAIN', '');
    vi.stubEnv('APP_URL', '');
    // Falha fechado: a action traduz em erro de fluxo. Redirecionar para um
    // domínio adivinhado é pior do que não redirecionar.
    expect(requestOrigin()).toBeNull();
  });
});
