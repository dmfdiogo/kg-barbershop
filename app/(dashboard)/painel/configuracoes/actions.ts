'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole } from '@/lib/auth/rbac';
import {
  loadPortalSettings,
  updatePortalAddress,
  updateTenantPolicies,
  type PortalSettings,
} from './service';
import {
  validatePoliciesForm,
  validatePortalAddress,
  type PoliciesField,
  type PoliciesFormInput,
  type PortalAddressField,
  type TenantPoliciesValue,
} from './validation';

/**
 * Server actions das configurações (tarefa F2.4).
 *
 * O tenant NUNCA vem do formulário: sai de `requireRole('OWNER')`, que lê o
 * membro do tenant ativo da sessão. A validação é refeita aqui — o cliente não
 * dita o que vai ao banco.
 */

const CONFIG_PATH = '/painel/configuracoes';

export type PoliciesActionResult =
  | { ok: true; policies: TenantPoliciesValue }
  | { ok: false; code: 'FORBIDDEN'; message: string }
  | {
      ok: false;
      code: 'INVALID';
      message: string;
      fieldErrors: Partial<Record<PoliciesField, string>>;
    };

export type PortalAddressActionResult =
  | { ok: true; settings: PortalSettings }
  | { ok: false; code: 'FORBIDDEN'; message: string }
  | {
      ok: false;
      code: 'INVALID';
      message: string;
      fieldErrors: Partial<Record<PortalAddressField, string>>;
    }
  | {
      ok: false;
      code: 'PRO_REQUIRED' | 'SLUG_TAKEN' | 'DOMAIN_TAKEN';
      message: string;
      fieldErrors?: Partial<Record<PortalAddressField, string>>;
    };

async function ownerOrNull() {
  try {
    return await requireRole('OWNER');
  } catch (error) {
    if (error instanceof AuthError) return null;
    throw error;
  }
}

export async function savePoliciesAction(input: PoliciesFormInput): Promise<PoliciesActionResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono edita as políticas.' };
  }

  const validation = validatePoliciesForm(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  await context.forTenant((tx) =>
    updateTenantPolicies(tx, context.tenant.id, context.user.id, validation.value),
  );
  revalidatePath(CONFIG_PATH);

  return { ok: true, policies: validation.value };
}

export async function savePortalAddressAction(input: {
  slug: unknown;
  customDomain: unknown;
}): Promise<PortalAddressActionResult> {
  const context = await ownerOrNull();
  if (!context) {
    return { ok: false, code: 'FORBIDDEN', message: 'Apenas o dono edita o endereço do portal.' };
  }

  const validation = validatePortalAddress(input);
  if (!validation.ok) {
    return {
      ok: false,
      code: 'INVALID',
      message: 'Verifique os campos destacados.',
      fieldErrors: validation.fieldErrors,
    };
  }

  const result = await context.forTenant((tx) =>
    updatePortalAddress(tx, context.tenant.id, context.user.id, validation.value),
  );

  if (!result.ok) {
    switch (result.code) {
      case 'PRO_REQUIRED':
        return {
          ok: false,
          code: 'PRO_REQUIRED',
          message: 'Domínio próprio é exclusivo do plano Pro.',
          fieldErrors: { customDomain: 'Disponível a partir do plano Pro.' },
        };
      case 'SLUG_TAKEN':
        return {
          ok: false,
          code: 'SLUG_TAKEN',
          message: 'Este endereço já está em uso por outro estabelecimento.',
          fieldErrors: { slug: 'Endereço já em uso. Escolha outro.' },
        };
      case 'DOMAIN_TAKEN':
        return {
          ok: false,
          code: 'DOMAIN_TAKEN',
          message: 'Este domínio já está em uso por outro estabelecimento.',
          fieldErrors: { customDomain: 'Domínio já em uso. Escolha outro.' },
        };
    }
  }

  revalidatePath(CONFIG_PATH);
  const settings = await context.forTenant((tx) => loadPortalSettings(tx, context.tenant.id));
  return { ok: true, settings };
}
