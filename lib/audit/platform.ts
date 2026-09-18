import { requireSuperAdmin } from '@/lib/auth/rbac';
import { asPlatformAdmin, type TenantTransaction, type TransactionOptions } from '@/lib/tenant/db';
import { recordAuditLog } from './record';
import type { PlatformAuditInput } from './types';

/**
 * Acesso auditado da plataforma a dado de tenant (tarefa F1.4).
 *
 * Este é o único caminho para o Super Admin ler dado de negócio de um tenant.
 * O portão (`app/(platform)/layout.tsx`) só decide quem enxerga a área; é AQUI
 * que se lê o dado — e ler implica deixar rastro.
 *
 * Ordem, e por que ela importa:
 *
 *   1. `requireSuperAdmin()` revalida a sessão e `User.isSuperAdmin`. O "quem"
 *      sai da sessão, não de um parâmetro do chamador: não dá para registrar um
 *      acesso em nome de outra pessoa.
 *   2. o `AuditLog` é gravado em transação PRÓPRIA e commitado ANTES do acesso.
 *      Fail-closed: se o registro falhar, a leitura não acontece. A linha
 *      registra a tentativa — uma leitura que falhe depois não apaga o rastro,
 *      que é exatamente o que "ninguém olha dado de cliente de salão sem
 *      deixar rastro" (F7.3) exige de um log de auditoria.
 *   3. a callback roda em `asPlatformAdmin()`, o bypass EXPLÍCITO de RLS da
 *      F0.2 (`contexto-comum.md` §4). Não existe bypass implícito neste
 *      projeto, e este helper não inventa um.
 *
 * A callback pode ser reexecutada uma vez sob disputa (retry de P2034, o mesmo
 * contrato de `forTenant()`): só código de banco reexecutável lá dentro. O
 * registro de auditoria fica FORA dessa transação, então o retry não duplica
 * nem apaga linha.
 *
 * SEMÂNTICA DO REGISTRO — tentativa, não leitura confirmada: a linha atesta que
 * o Super Admin INICIOU um acesso, não que o dado chegou a ser lido. Uma leitura
 * que falhe depois deixa a linha de propósito: este log existe para responder
 * "alguém olhou o dado desta cliente?", e nele falso positivo é ruído barato
 * enquanto falso negativo é a falha que invalida o log inteiro. Quem ler uma
 * linha daqui não pode concluir que a leitura aconteceu — ela pode ter falhado.
 *
 * Uso (F7.3):
 *
 *   const tenant = await withPlatformAudit(
 *     { tenantId, action: auditAction('Tenant', 'support_access'), entity: 'Tenant', entityId: tenantId },
 *     (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
 *   );
 */
export async function withPlatformAudit<T>(
  input: PlatformAuditInput,
  fn: (tx: TenantTransaction) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const admin = await requireSuperAdmin();

  await asPlatformAdmin((tx) =>
    recordAuditLog(tx, {
      tenantId: input.tenantId,
      actorId: admin.user.id,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
    }),
  );

  return asPlatformAdmin(fn, options);
}
