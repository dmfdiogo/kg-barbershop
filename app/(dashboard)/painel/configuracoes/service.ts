import type { TenantTransaction } from '@/lib/tenant/db';
import { recordAuditLog } from '@/lib/audit/record';
import { auditAction } from '@/lib/audit/types';
import { isWithinCancellationWindow } from '@/lib/booking/availability';
import { postgresErrorCode } from '@/lib/tenant/errors';
import type { TenantPoliciesValue } from './validation';

/**
 * Núcleo de dados de políticas e endereço do portal (tarefa F2.4).
 *
 * Recebe a transação JÁ escopada por `context.forTenant()`: não abre transação,
 * não conhece `next/*` e é reexecutável sob retry. Toda query carrega
 * `tenantId` explícito além da RLS.
 */

export async function loadTenantPolicies(
  tx: TenantTransaction,
  tenantId: string,
): Promise<TenantPoliciesValue> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      cancellationWindowHours: true,
      minAdvanceMinutes: true,
      maxAdvanceMinutes: true,
      noShowPolicyText: true,
    },
  });
  return tenant;
}

export async function updateTenantPolicies(
  tx: TenantTransaction,
  tenantId: string,
  actorId: string,
  value: TenantPoliciesValue,
): Promise<void> {
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      cancellationWindowHours: value.cancellationWindowHours,
      minAdvanceMinutes: value.minAdvanceMinutes,
      maxAdvanceMinutes: value.maxAdvanceMinutes,
      noShowPolicyText: value.noShowPolicyText,
    },
  });

  await recordAuditLog(tx, {
    tenantId,
    actorId,
    action: auditAction('Tenant', 'policies_update'),
    entity: 'Tenant',
    entityId: tenantId,
  });
}

/**
 * Ponte entre a CONFIGURAÇÃO e o DOMÍNIO. Carrega a janela gravada e a entrega
 * à regra de cancelamento (`lib/booking/availability.ts`): é o que faz "mudar a
 * janela" mudar de fato o que o domínio decide, sem segunda cópia da constante.
 */
export async function canCustomerCancel(
  tx: TenantTransaction,
  tenantId: string,
  startsAt: Date,
  now: Date = new Date(),
): Promise<boolean> {
  const policies = await loadTenantPolicies(tx, tenantId);
  return isWithinCancellationWindow({
    startsAt,
    cancellationWindowHours: policies.cancellationWindowHours,
    now,
  });
}

// ---------------------------------------------------------------------------
// Endereço do portal
// ---------------------------------------------------------------------------

export interface PortalSettings {
  slug: string;
  customDomain: string | null;
  /** Domínio próprio é recurso do plano Pro (o provisionamento é fase 2 do produto). */
  isPro: boolean;
}

export async function loadPortalSettings(
  tx: TenantTransaction,
  tenantId: string,
): Promise<PortalSettings> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { slug: true, customDomain: true },
  });
  const subscription = await tx.platformSub.findUnique({
    where: { tenantId },
    select: { plan: true },
  });

  return {
    slug: tenant.slug,
    customDomain: tenant.customDomain,
    isPro: subscription?.plan === 'PRO',
  };
}

export type PortalAddressUpdateResult =
  | { ok: true }
  | { ok: false; code: 'PRO_REQUIRED' | 'SLUG_TAKEN' | 'DOMAIN_TAKEN' };

/**
 * Detecta a violação de unicidade sem depender da forma do erro do Prisma: com
 * driver adapter o 23505 pode chegar como `PrismaClientKnownRequestError`
 * (P2002) ou já como SQLSTATE, e o `target` é o nome da constraint
 * (`tenant_slug_key`), não a coluna. Procuramos a coluna no alvo e na mensagem.
 */
function isUniqueViolation(error: unknown, column: string): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : '';
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  const targetText = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : '';

  const isUnique =
    code === 'P2002' || code === '23505' || postgresErrorCode(error) === '23505' || /unique constraint/i.test(message);
  if (!isUnique) return false;

  const haystack = `${targetText} ${message}`.toLowerCase();
  return haystack.includes(column) || haystack.includes(column.replace(/_/g, ' '));
}

export async function updatePortalAddress(
  tx: TenantTransaction,
  tenantId: string,
  actorId: string,
  value: { slug: string; customDomain: string | null },
): Promise<PortalAddressUpdateResult> {
  const portal = await loadPortalSettings(tx, tenantId);

  if (value.customDomain !== null && !portal.isPro) {
    return { ok: false, code: 'PRO_REQUIRED' };
  }

  try {
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        slug: value.slug,
        // Fora do Pro o campo fica intocado: um domínio já configurado não é
        // apagado só porque o dono salvou o slug.
        ...(portal.isPro ? { customDomain: value.customDomain } : {}),
      },
    });
  } catch (error) {
    if (isUniqueViolation(error, 'custom_domain')) return { ok: false, code: 'DOMAIN_TAKEN' };
    if (isUniqueViolation(error, 'slug')) return { ok: false, code: 'SLUG_TAKEN' };
    throw error;
  }

  await recordAuditLog(tx, {
    tenantId,
    actorId,
    action: auditAction('Tenant', 'portal_address_update'),
    entity: 'Tenant',
    entityId: tenantId,
  });

  return { ok: true };
}
