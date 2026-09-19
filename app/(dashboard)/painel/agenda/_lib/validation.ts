import { isE164 } from '@/lib/messaging/types';
import { localDateTimeToInstant } from '@/lib/staffing/time';
import type { AgendaFieldErrors, ValidatedWalkIn, WalkInFormInput } from './types';

/**
 * Validação do walk-in (tarefa F3.5). O servidor NUNCA confia no cliente: a
 * tela também valida, mas é aqui que se decide o que vai ao banco. Toda mensagem
 * em pt-BR, pronta para exibição.
 *
 * `startsAtLocal` vem do relógio do tenant ("YYYY-MM-DDTHH:mm") e é convertido
 * para instante UTC com `date-fns-tz` — nunca com `new Date()` local, que
 * deslocaria o horário pelo fuso do processo.
 */

export const WALK_IN_NAME_MAX = 120;
export const WALK_IN_NAME_MIN = 2;
export const WALK_IN_PHONE_MAX = 16;

export type WalkInValidationResult =
  | { ok: true; value: ValidatedWalkIn }
  | { ok: false; fieldErrors: AgendaFieldErrors };

export function validateWalkInForm(
  input: WalkInFormInput,
  timezone: string,
): WalkInValidationResult {
  const fieldErrors: AgendaFieldErrors = {};

  const staffId = typeof input.staffId === 'string' ? input.staffId.trim() : '';
  if (staffId.length === 0) {
    fieldErrors.staffId = 'Escolha o profissional.';
  }

  const serviceId = typeof input.serviceId === 'string' ? input.serviceId.trim() : '';
  if (serviceId.length === 0) {
    fieldErrors.serviceId = 'Escolha o serviço.';
  }

  const customerName = typeof input.customerName === 'string' ? input.customerName.trim() : '';
  if (customerName.length < WALK_IN_NAME_MIN || customerName.length > WALK_IN_NAME_MAX) {
    fieldErrors.customerName = `Informe um nome de ${WALK_IN_NAME_MIN} a ${WALK_IN_NAME_MAX} caracteres.`;
  }

  const customerPhone = typeof input.customerPhone === 'string' ? input.customerPhone.trim() : '';
  if (customerPhone.length > WALK_IN_PHONE_MAX || !isE164(customerPhone)) {
    fieldErrors.customerPhone = 'Informe o WhatsApp com DDI e DDD, ex.: +5548999999999.';
  }

  const startsAtLocal = typeof input.startsAtLocal === 'string' ? input.startsAtLocal.trim() : '';
  const startsAt = startsAtLocal.length > 0 ? localDateTimeToInstant(startsAtLocal, timezone) : null;
  if (!startsAt) {
    fieldErrors.startsAt = 'Informe o horário de início.';
  }

  if (Object.keys(fieldErrors).length > 0 || !startsAt) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, value: { staffId, serviceId, customerName, customerPhone, startsAt } };
}
