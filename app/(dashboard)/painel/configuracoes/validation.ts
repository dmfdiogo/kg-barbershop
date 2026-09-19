import { parseIntInRange } from '@/lib/catalog/money';
import { normalizeSlug, validateSlug, slugValidationMessage } from '@/lib/tenant/slugs';

/**
 * Validação PURA das políticas e do endereço do portal (tarefa F2.4).
 *
 * Sem banco e sem `next/*`: o formulário entrega strings e o servidor decide o
 * que vai ao banco. A validação roda de novo na server action — o cliente nunca
 * dita o que é gravado. O formato de slug vem de `lib/tenant/slugs.ts` (F1.0),
 * a MESMA regra do proxy: validar com uma cópia local deixaria a configuração
 * aceitar um slug que o roteamento depois recusa.
 */

export const CANCELLATION_HOURS_MIN = 0;
export const CANCELLATION_HOURS_MAX = 24 * 30;
export const ADVANCE_MINUTES_MIN = 0;
export const ADVANCE_MINUTES_MAX = 60 * 24 * 365;
export const NO_SHOW_TEXT_MAX = 2000;
export const CUSTOM_DOMAIN_MAX = 253;

export interface TenantPoliciesValue {
  cancellationWindowHours: number;
  minAdvanceMinutes: number;
  maxAdvanceMinutes: number | null;
  noShowPolicyText: string | null;
}

export interface PoliciesFormInput {
  cancellationWindowHours: unknown;
  minAdvanceMinutes: unknown;
  maxAdvanceMinutes: unknown;
  noShowPolicyText: unknown;
}

export type PoliciesField = keyof PoliciesFormInput;

export type PoliciesValidation =
  | { ok: true; value: TenantPoliciesValue }
  | { ok: false; fieldErrors: Partial<Record<PoliciesField, string>> };

/** Campo opcional: vazio/ausente vira `null`; não vazio é validado. */
function optionalInt(
  raw: unknown,
  min: number,
  max: number,
): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'string' && raw.trim().length === 0) return { ok: true, value: null };
  const parsed = parseIntInRange(raw, min, max);
  return parsed === null ? { ok: false } : { ok: true, value: parsed };
}

export function validatePoliciesForm(input: PoliciesFormInput): PoliciesValidation {
  const fieldErrors: Partial<Record<PoliciesField, string>> = {};

  const cancellation = parseIntInRange(
    input.cancellationWindowHours,
    CANCELLATION_HOURS_MIN,
    CANCELLATION_HOURS_MAX,
  );
  if (cancellation === null) {
    fieldErrors.cancellationWindowHours = `Informe um número inteiro entre ${CANCELLATION_HOURS_MIN} e ${CANCELLATION_HOURS_MAX} horas.`;
  }

  const minAdvance = parseIntInRange(
    input.minAdvanceMinutes,
    ADVANCE_MINUTES_MIN,
    ADVANCE_MINUTES_MAX,
  );
  if (minAdvance === null) {
    fieldErrors.minAdvanceMinutes = `Informe um número inteiro de minutos entre ${ADVANCE_MINUTES_MIN} e ${ADVANCE_MINUTES_MAX}.`;
  }

  const maxAdvance = optionalInt(input.maxAdvanceMinutes, ADVANCE_MINUTES_MIN, ADVANCE_MINUTES_MAX);
  if (!maxAdvance.ok) {
    fieldErrors.maxAdvanceMinutes = 'Deixe em branco para não limitar, ou informe um número de minutos válido.';
  } else if (maxAdvance.value !== null && minAdvance !== null && maxAdvance.value < minAdvance) {
    fieldErrors.maxAdvanceMinutes =
      'A antecedência máxima não pode ser menor que a antecedência mínima.';
  }

  let noShow: string | null = null;
  if (input.noShowPolicyText !== null && input.noShowPolicyText !== undefined) {
    if (typeof input.noShowPolicyText !== 'string') {
      fieldErrors.noShowPolicyText = 'Texto inválido.';
    } else {
      const trimmed = input.noShowPolicyText.trim();
      if (trimmed.length > NO_SHOW_TEXT_MAX) {
        fieldErrors.noShowPolicyText = `Use no máximo ${NO_SHOW_TEXT_MAX} caracteres.`;
      } else {
        noShow = trimmed.length > 0 ? trimmed : null;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return {
    ok: true,
    value: {
      cancellationWindowHours: cancellation as number,
      minAdvanceMinutes: minAdvance as number,
      maxAdvanceMinutes: maxAdvance.ok ? maxAdvance.value : null,
      noShowPolicyText: noShow,
    },
  };
}

// ---------------------------------------------------------------------------
// Endereço do portal
// ---------------------------------------------------------------------------

export type PortalAddressField = 'slug' | 'customDomain';

export type PortalAddressValidation =
  | {
      ok: true;
      value: { slug: string; customDomain: string | null };
    }
  | { ok: false; fieldErrors: Partial<Record<PortalAddressField, string>> };

// Um host: rótulos alfanuméricos (com hífen interno) separados por ponto.
const DOMAIN_FORMAT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeCustomDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

export function validatePortalAddress(input: {
  slug: unknown;
  customDomain: unknown;
}): PortalAddressValidation {
  const fieldErrors: Partial<Record<PortalAddressField, string>> = {};

  const slugResult = validateSlug(typeof input.slug === 'string' ? input.slug : '');
  let slug = '';
  if (!slugResult.ok) {
    fieldErrors.slug = slugValidationMessage(slugResult.reason);
  } else {
    slug = slugResult.slug;
  }

  let customDomain: string | null = null;
  if (input.customDomain !== null && input.customDomain !== undefined) {
    if (typeof input.customDomain !== 'string') {
      fieldErrors.customDomain = 'Domínio inválido.';
    } else {
      const normalized = normalizeCustomDomain(input.customDomain);
      if (normalized.length === 0) {
        customDomain = null;
      } else if (normalized.length > CUSTOM_DOMAIN_MAX || !DOMAIN_FORMAT.test(normalized)) {
        fieldErrors.customDomain =
          'Informe só o domínio, sem http:// nem caminho. Ex.: www.seusalao.com.br.';
      } else {
        customDomain = normalized;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { slug: normalizeSlug(slug), customDomain } };
}
