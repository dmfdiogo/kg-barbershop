// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { notificationBackoffMs } from '@/lib/messaging/jobs';
import {
  OTP_TEMPLATE,
  TEMPLATES,
  isJobTemplateName,
  isTemplateName,
} from '@/lib/messaging/templates';

/**
 * Registro central de templates (F6.0) e política de backoff do runner.
 * O registro é o contrato que a aprovação da Meta na F8 vai fixar: um template
 * declarado aqui tem nome, categoria, público e variáveis; nada fora daqui pode
 * ser enviado (o mock recusa, e o provider real recusará).
 */

describe('registro de templates', () => {
  it('todo template declara categoria, público e variáveis únicas', () => {
    for (const [key, definition] of Object.entries(TEMPLATES)) {
      expect(definition.name).toBe(key);
      expect(['AUTHENTICATION', 'UTILITY']).toContain(definition.category);
      expect(['CUSTOMER', 'STAFF']).toContain(definition.audience);
      expect(definition.variables.length).toBeGreaterThan(0);
      expect(new Set(definition.variables).size).toBe(definition.variables.length);
    }
  });

  it('OTP não é job; todos os demais templates são elegíveis a job', () => {
    expect(isTemplateName(OTP_TEMPLATE)).toBe(true);
    expect(isJobTemplateName(OTP_TEMPLATE)).toBe(false);

    for (const key of Object.keys(TEMPLATES)) {
      if (key === OTP_TEMPLATE) continue;
      expect(isJobTemplateName(key)).toBe(true);
    }
  });

  it('recusa nome fora do registro', () => {
    expect(isTemplateName('template_inventado')).toBe(false);
    expect(isJobTemplateName('template_inventado')).toBe(false);
  });
});

describe('backoff de retentativa', () => {
  it('cresce com a tentativa e estaciona no teto', () => {
    const first = notificationBackoffMs(1);
    expect(first).toBeGreaterThan(0);
    expect(notificationBackoffMs(2)).toBeGreaterThanOrEqual(first);
    expect(notificationBackoffMs(3)).toBeGreaterThanOrEqual(notificationBackoffMs(2));

    const ceiling = notificationBackoffMs(4);
    expect(notificationBackoffMs(5)).toBe(ceiling);
    expect(notificationBackoffMs(50)).toBe(ceiling);
  });
});
