import { isE164 } from '@/lib/messaging/types';

/**
 * Normalização do WhatsApp digitado na tela de identificação (F1.2).
 *
 * O contrato do OTP (`RequestOtpInput.phone`) exige E.164 — `+5548999999999`.
 * O cliente final, no celular, digita do jeito brasileiro: com parênteses,
 * espaços, hífen, às vezes sem o DDI. Esta função traduz esse formato para o
 * canônico SEM inventar país quando o usuário já informou um DDI.
 *
 * Devolve `null` quando não dá para formar um E.164 válido — a tela mostra a
 * mensagem de formato em vez de deixar a server action responder INVALID_PHONE.
 */
export function normalizePhoneToE164(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const hasCountryCode = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 0) return null;

  // DDI explícito: respeita exatamente o que foi digitado.
  if (hasCountryCode) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }

  // Sem DDI, assume Brasil (o produto começa no mercado brasileiro).
  if (digits.length === 10 || digits.length === 11) {
    const candidate = `+55${digits}`;
    return isE164(candidate) ? candidate : null;
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    const candidate = `+${digits}`;
    return isE164(candidate) ? candidate : null;
  }

  return null;
}

/**
 * Mostra um E.164 no formato brasileiro legível. Para números de outro país,
 * cai num formato internacional genérico (o importante é nunca exibir o
 * `+` cru sem separação para conferência do cliente).
 */
export function formatPhoneForDisplay(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const head = rest.slice(0, rest.length - 4);
    const tail = rest.slice(-4);
    return `+55 (${ddd}) ${head}-${tail}`;
  }
  return `+${digits}`;
}
