import type { TenantTransaction } from '@/lib/tenant/db';
import { recordAuditLog } from '@/lib/audit/record';
import { auditAction } from '@/lib/audit/types';
import type { ThemePreset } from '@/lib/theme/presets';
import type { BrandingDraft } from './validation';

/**
 * Persistência da marca do tenant (tarefa F2.3).
 *
 * Sem `import.meta` nem `next/*`: recebe a transação JÁ escopada pelo
 * `forTenant()` do contexto. As cores vão para as colunas de `Tenant`; o
 * `themePreset` guarda só o rótulo (ver `lib/theme/presets.ts`).
 *
 * `logoUrl` é tri-estado de propósito:
 *   - `undefined` → não mexe no logo (só cores/preset nesta gravação);
 *   - `null`      → remove;
 *   - string      → substitui pela nova data URL.
 */

export interface BrandingPersistInput {
  colors: BrandingDraft;
  preset: ThemePreset | null;
  logoUrl?: string | null;
}

export async function persistBranding(
  tx: TenantTransaction,
  tenantId: string,
  actorId: string,
  input: BrandingPersistInput,
): Promise<void> {
  await tx.tenant.update({
    where: { id: tenantId },
    data: {
      colorPrimary: input.colors.primary,
      colorSecondary: input.colors.secondary,
      colorBackground: input.colors.background,
      themePreset: input.preset?.id ?? null,
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
    },
  });

  await recordAuditLog(tx, {
    tenantId,
    actorId,
    action: auditAction('Tenant', 'branding_update'),
    entity: 'Tenant',
    entityId: tenantId,
  });
}
