// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePaymentsWebhookUrl } from '@/lib/payments/webhook';

/**
 * Fora de request scope (que é o caso aqui) a resolução cai para as variáveis.
 * A prioridade do host da requisição é exercida pelos testes de integração com
 * `next dev`, onde `headers()` existe.
 */
describe('resolvePaymentsWebhookUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('usa PAYMENTS_WEBHOOK_URL como override explícito', async () => {
    vi.stubEnv('PAYMENTS_WEBHOOK_URL', 'http://exemplo.test/hook');
    await expect(resolvePaymentsWebhookUrl()).resolves.toBe('http://exemplo.test/hook');
  });

  it('deriva de APP_URL', async () => {
    vi.stubEnv('APP_URL', 'http://127.0.0.1:4000');
    await expect(resolvePaymentsWebhookUrl()).resolves.toBe(
      'http://127.0.0.1:4000/api/webhooks/payments',
    );
  });

  it('cai para PORT quando não há URL configurada', async () => {
    vi.stubEnv('PORT', '4321');
    await expect(resolvePaymentsWebhookUrl()).resolves.toBe(
      'http://127.0.0.1:4321/api/webhooks/payments',
    );
  });

  it('falha com mensagem explícita quando nada resolve', async () => {
    vi.stubEnv('PAYMENTS_WEBHOOK_URL', undefined);
    vi.stubEnv('APP_URL', undefined);
    vi.stubEnv('PORT', undefined);

    await expect(resolvePaymentsWebhookUrl()).rejects.toThrow(/PAYMENTS_WEBHOOK_URL/);
  });
});
