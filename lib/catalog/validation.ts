import { parseIntInRange, parseMoneyToCents, parsePercentToInt } from './money';
import {
  PAYMENT_MODES,
  type PaymentMode,
  type ServiceFieldErrors,
  type ServiceFormInput,
  type ServiceValidationResult,
  type ValidatedService,
} from './types';

/**
 * Validação do formulário de serviço (tarefa F2.1).
 *
 * O servidor NUNCA confia no cliente: mesmo que a tela já tenha validado, a
 * server action revalida aqui e é esta função que decide o que vai para o
 * banco. Toda mensagem em pt-BR, pronta para exibição.
 *
 * Regras de cobrança:
 *   - `FULL_PREPAID` e `ON_SITE` não têm sinal (ambos os campos ficam nulos);
 *   - `DEPOSIT` exige EXATAMENTE um entre valor fixo e percentual;
 *   - o sinal nunca pode superar o preço total.
 */

export const NAME_MIN = 2;
export const NAME_MAX = 80;
export const DURATION_MIN = 5;
export const DURATION_MAX = 720;
export const BUFFER_MIN = 0;
export const BUFFER_MAX = 240;
export const DEPOSIT_PERCENT_MIN = 1;
export const DEPOSIT_PERCENT_MAX = 100;

function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === 'string' && (PAYMENT_MODES as readonly string[]).includes(value);
}

function normalizeStaffIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) seen.add(entry.trim());
  }
  return [...seen];
}

export function validateServiceForm(input: ServiceFormInput): ServiceValidationResult {
  const fieldErrors: ServiceFieldErrors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    fieldErrors.name = `Informe um nome de ${NAME_MIN} a ${NAME_MAX} caracteres.`;
  }

  const durationMin = parseIntInRange(input.durationMin, DURATION_MIN, DURATION_MAX);
  if (durationMin === null) {
    fieldErrors.durationMin = `Duração entre ${DURATION_MIN} e ${DURATION_MAX} minutos.`;
  }

  const bufferMin = parseIntInRange(input.bufferMin ?? 0, BUFFER_MIN, BUFFER_MAX);
  if (bufferMin === null) {
    fieldErrors.bufferMin = `Buffer entre ${BUFFER_MIN} e ${BUFFER_MAX} minutos.`;
  }

  const priceCents = parseMoneyToCents(input.price);
  if (priceCents === null) {
    fieldErrors.price = 'Informe um preço válido, ex.: 50,00.';
  }

  if (!isPaymentMode(input.paymentMode)) {
    fieldErrors.paymentMode = 'Escolha a forma de cobrança.';
  }

  const paymentMode = isPaymentMode(input.paymentMode) ? input.paymentMode : null;
  let depositCents: number | null = null;
  let depositPercent: number | null = null;

  if (paymentMode === 'DEPOSIT') {
    const mode = input.depositMode;
    if (mode === 'CENTS') {
      depositCents = parseMoneyToCents(input.depositValue);
      if (depositCents === null || depositCents <= 0) {
        fieldErrors.deposit = 'Informe o valor do sinal.';
      } else if (priceCents !== null && depositCents > priceCents) {
        fieldErrors.deposit = 'O sinal não pode ser maior que o preço.';
      }
    } else if (mode === 'PERCENT') {
      depositPercent = parsePercentToInt(input.depositValue);
      if (
        depositPercent === null ||
        depositPercent < DEPOSIT_PERCENT_MIN ||
        depositPercent > DEPOSIT_PERCENT_MAX
      ) {
        fieldErrors.deposit = `Informe um percentual entre ${DEPOSIT_PERCENT_MIN} e ${DEPOSIT_PERCENT_MAX}.`;
      }
    } else {
      fieldErrors.deposit = 'Escolha entre valor fixo e percentual do sinal.';
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  const value: ValidatedService = {
    name,
    durationMin: durationMin as number,
    bufferMin: bufferMin as number,
    priceCents: priceCents as number,
    paymentMode: paymentMode as PaymentMode,
    depositCents,
    depositPercent,
    active: input.active === undefined ? true : input.active === true,
    staffIds: normalizeStaffIds(input.staffIds),
  };

  return { ok: true, value };
}
