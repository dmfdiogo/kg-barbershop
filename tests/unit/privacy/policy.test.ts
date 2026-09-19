// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isE164 } from '@/lib/messaging/types';
import {
  ANONYMIZED_CUSTOMER_NAME,
  ANONYMIZED_PHONE_PREFIX,
  FISCAL_RETENTION_YEARS,
  anonymizedPhone,
  isAnonymizedPhone,
} from '@/lib/privacy/policy';

/**
 * Política de exclusão/anonimização (tarefa F6.2).
 *
 * O telefone-túmulo PRECISA ficar fora de E.164: o runner de mensagens só envia
 * para número válido, e um túmulo com formato válido poderia disparar WhatsApp
 * para um número real. Este teste existe para impedir que alguém "conserte" o
 * formato depois.
 */
describe('política de privacidade', () => {
  it('o telefone anonimizado não é E.164 e é reconhecível', () => {
    const phone = anonymizedPhone();
    expect(phone.startsWith(ANONYMIZED_PHONE_PREFIX)).toBe(true);
    expect(isE164(phone)).toBe(false);
    expect(isAnonymizedPhone(phone)).toBe(true);
  });

  it('cada túmulo é único', () => {
    expect(anonymizedPhone()).not.toBe(anonymizedPhone());
  });

  it('telefone comum não é confundido com anonimizado', () => {
    expect(isAnonymizedPhone('+5548999999999')).toBe(false);
  });

  it('registra o nome do túmulo e o prazo fiscal', () => {
    expect(ANONYMIZED_CUSTOMER_NAME).toBe('Cliente anonimizado');
    expect(FISCAL_RETENTION_YEARS).toBe(5);
  });
});
