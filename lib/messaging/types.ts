import type { TemplateName } from './templates';

/**
 * Telefone no padrão E.164 (`+5548999999999`). É a chave de identidade do
 * cliente (`fases/contexto-comum.md` §3.4), então todo provider — mock ou real —
 * valida o formato em runtime antes de enviar.
 */
export type E164 = string;

const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function isE164(value: string): value is E164 {
  return E164_PATTERN.test(value);
}

/**
 * Código OTP de 6 dígitos (spec-executiva.md §4). A Cloud API real recusa
 * payload de autenticação fora desse formato; o mock reproduz a recusa.
 */
export const OTP_CODE_PATTERN = /^\d{6}$/;

export interface WhatsAppProvider {
  sendOtp(to: E164, code: string): Promise<{ providerMessageId: string }>;
  sendTemplate(
    to: E164,
    template: TemplateName,
    vars: Record<string, string>,
  ): Promise<{ providerMessageId: string }>;
}

export type MessagingErrorCode =
  | 'INVALID_PHONE'
  | 'INVALID_OTP_CODE'
  | 'UNKNOWN_TEMPLATE'
  | 'MISSING_TEMPLATE_VARIABLE'
  | 'UNKNOWN_TEMPLATE_VARIABLE';

/**
 * Erro de domínio dos providers de mensageria. Os adaptadores reais devem
 * traduzir as falhas do provedor para estes mesmos códigos, para que o código
 * de produto não precise ramificar por provider.
 */
export class MessagingProviderError extends Error {
  constructor(
    readonly code: MessagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MessagingProviderError';
  }
}
