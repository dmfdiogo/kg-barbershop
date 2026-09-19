// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MESSAGING_CHANNEL,
  isOptOutExemptTemplate,
  isOptOutableTemplate,
} from '@/lib/messaging/preferences';

/**
 * Classificação de opt-out (tarefa F6.2).
 *
 * A regra que não pode regredir: opt-out barra conveniência (lembretes), nunca
 * o transacional crítico (confirmação/cancelamento/remarcação do próprio
 * agendamento). Mensagem para o profissional não é afetada pela preferência do
 * cliente.
 */
describe('classificação de opt-out por template', () => {
  it('o canal padrão do produto é WhatsApp', () => {
    expect(DEFAULT_MESSAGING_CHANNEL).toBe('WHATSAPP');
  });

  it('lembretes (conveniência) podem ser barrados', () => {
    expect(isOptOutableTemplate('booking_reminder_d1')).toBe(true);
    expect(isOptOutableTemplate('booking_reminder_h2')).toBe(true);
  });

  it('transacional crítico do cliente nunca é barrado', () => {
    for (const template of [
      'booking_confirmation',
      'booking_cancelled_customer',
      'booking_rescheduled_customer',
    ] as const) {
      expect(isOptOutableTemplate(template)).toBe(false);
      expect(isOptOutExemptTemplate(template)).toBe(true);
    }
  });

  it('mensagem para o profissional não é afetada pelo opt-out do cliente', () => {
    for (const template of [
      'booking_created_staff',
      'booking_cancelled_staff',
      'booking_rescheduled_staff',
    ] as const) {
      expect(isOptOutableTemplate(template)).toBe(false);
    }
  });
});
