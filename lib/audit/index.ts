/**
 * Auditoria (tarefa F1.4).
 *
 * - `withPlatformAudit()` é o acesso auditado do Super Admin a dado de tenant:
 *   exige o portão, grava o `AuditLog` e só então lê via `asPlatformAdmin()`.
 * - `recordAuditLog()` é a escrita crua, para quem já tem uma transação aberta
 *   (ex.: ação do sistema com `actorId: null`).
 *
 * A linha de auditoria registra a TENTATIVA de acesso, não a leitura
 * confirmada: ela é commitada antes do dado ser tocado e não some se a leitura
 * falhar depois.
 *
 * A resolução de tenant do roteamento NÃO passa por aqui de propósito: auditar
 * cada requisição encheria o log e destruiria seu propósito (ver
 * `lib/tenant/context.ts`).
 */
export { withPlatformAudit } from './platform';
export { recordAuditLog } from './record';
export { auditAction, type AuditLogEntryInput, type PlatformAuditInput } from './types';
