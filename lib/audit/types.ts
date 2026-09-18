/**
 * Modelo do `AuditLog` (tarefa F1.4): quem, o quê, qual entidade, quando.
 *
 * A tabela nasceu na F0.2 congelada (`tenantId, actorId, action, entity,
 * entityId, createdAt`); aqui está o contrato tipado de escrita. O log é
 * append-only: nunca se atualiza nem se apaga uma linha de auditoria em código
 * de produto.
 *
 * SEMÂNTICA: uma linha atesta uma TENTATIVA de acesso, não uma leitura
 * confirmada. O rastro é gravado antes do dado ser tocado e sobrevive a uma
 * leitura que falhe depois (`withPlatformAudit`); quem lê o log não pode
 * concluir que o dado foi efetivamente lido.
 *
 * O `createdAt` fica com o default `now()` do banco de propósito — o "quando"
 * é o relógio do servidor de dados, não o do processo da aplicação.
 */
export interface AuditLogEntryInput {
  /** Tenant cujo dado foi acessado. Todo registro de auditoria é de um tenant. */
  tenantId: string;
  /**
   * Quem: `User.id`. `null` apenas quando a ação é do sistema (cron/webhook),
   * que não tem usuário por trás — o caminho do Super Admin sempre preenche.
   */
  actorId: string | null;
  /**
   * O quê, na convenção `entidade.verbo` em minúsculas, ex.: `tenant.read`,
   * `booking.inspect`. Use `auditAction()` para montar o nome sem divergir.
   */
  action: string;
  /** Qual entidade (nome do modelo Prisma: `Tenant`, `Booking`, …). */
  entity: string;
  /** Id da linha quando o acesso é a um registro específico. */
  entityId?: string | null;
}

/**
 * Entrada do caminho auditado da plataforma (`withPlatformAudit`). O "quem" NÃO
 * é parâmetro: sai da sessão do Super Admin, para que nenhum chamador possa
 * registrar um acesso em nome de outra pessoa.
 */
export type PlatformAuditInput = Omit<AuditLogEntryInput, 'actorId'>;

/**
 * Convenção do campo `action`: `entidade.verbo`, com a entidade no singular e
 * em minúsculas (`Tenant` → `tenant.support_access`). O verbo é o que o acesso
 * fez — evite nomes de tela ("ver painel") e prefira o dado tocado
 * ("booking.inspect", "membership.list").
 */
export function auditAction(entity: string, verb: string): string {
  return `${entity.toLowerCase()}.${verb}`;
}
