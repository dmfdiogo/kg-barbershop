import { randomUUID } from 'node:crypto';
import { recordOutboxMessage } from './outbox';
import {
  OTP_TEMPLATE,
  checkTemplateVariables,
  isTemplateName,
  type TemplateName,
} from './templates';
import {
  MessagingProviderError,
  OTP_CODE_PATTERN,
  isE164,
  type E164,
  type WhatsAppProvider,
} from './types';

/**
 * Mock do WhatsApp usado de F1 a F7. Não é um stub permissivo: recusa o que a
 * Cloud API recusaria (número fora de E.164, template não aprovado, variáveis
 * fora do contrato do template) e registra tudo no outbox lido por /dev/outbox.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  async sendOtp(to: E164, code: string): Promise<{ providerMessageId: string }> {
    if (!isE164(to)) {
      throw new MessagingProviderError(
        'INVALID_PHONE',
        `Telefone fora de E.164: ${JSON.stringify(to)}`,
      );
    }
    if (!OTP_CODE_PATTERN.test(code)) {
      throw new MessagingProviderError(
        'INVALID_OTP_CODE',
        'O código OTP deve ter exatamente 6 dígitos.',
      );
    }

    const providerMessageId = `wamid.mock.${randomUUID()}`;
    recordOutboxMessage({
      providerMessageId,
      to,
      kind: 'otp',
      template: OTP_TEMPLATE,
      code,
      vars: { code },
    });
    return { providerMessageId };
  }

  async sendTemplate(
    to: E164,
    template: TemplateName,
    vars: Record<string, string>,
  ): Promise<{ providerMessageId: string }> {
    if (!isE164(to)) {
      throw new MessagingProviderError(
        'INVALID_PHONE',
        `Telefone fora de E.164: ${JSON.stringify(to)}`,
      );
    }
    if (!isTemplateName(template)) {
      throw new MessagingProviderError(
        'UNKNOWN_TEMPLATE',
        `Template não registrado: ${JSON.stringify(template)}`,
      );
    }

    const { missing, unknown } = checkTemplateVariables(template, vars);
    if (missing.length > 0) {
      throw new MessagingProviderError(
        'MISSING_TEMPLATE_VARIABLE',
        `Template ${template}: variáveis obrigatórias ausentes: ${missing.join(', ')}`,
      );
    }
    if (unknown.length > 0) {
      throw new MessagingProviderError(
        'UNKNOWN_TEMPLATE_VARIABLE',
        `Template ${template}: variáveis não declaradas: ${unknown.join(', ')}`,
      );
    }

    const providerMessageId = `wamid.mock.${randomUUID()}`;
    recordOutboxMessage({
      providerMessageId,
      to,
      kind: 'template',
      template,
      vars,
    });
    return { providerMessageId };
  }
}

let singleton: MockWhatsAppProvider | undefined;

/** Instância compartilhada pelo código de produto e pelo console /dev. */
export function getMockWhatsAppProvider(): MockWhatsAppProvider {
  singleton ??= new MockWhatsAppProvider();
  return singleton;
}
