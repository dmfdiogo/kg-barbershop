import type { TenantTransaction } from '@/lib/tenant/db';
import type { AuditLogEntryInput } from './types';

/**
 * Escrita do `AuditLog` (tarefa F1.4).
 *
 * Recebe uma transação JÁ aberta em vez de abrir a sua: quem chama decide se o
 * registro é o primeiro passo do caminho auditado (`withPlatformAudit`) ou
 * parte de outra transação de negócio (ex.: ação futura do sistema com
 * `actorId: null`). A escrita é reexecutável — se a transação sofrer retry por
 * conflito, o insert é desfeito junto e commitado uma única vez.
 *
 * A RLS de `audit_log` é satisfeita pelo `tenantId` do próprio registro; do
 * caminho da plataforma isso acontece dentro de `asPlatformAdmin()`, o bypass
 * explícito da F0.2 — nunca implícito.
 */
export async function recordAuditLog(
  tx: TenantTransaction,
  input: AuditLogEntryInput,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
    },
  });
}
