import { randomUUID } from 'node:crypto';

/**
 * DECISÃO REGISTRADA — exclusão e anonimização do titular (LGPD, tarefa F6.2).
 *
 * Este arquivo é o registro da decisão pedida pela fase: o que é APAGADO, o que
 * é ANONIMIZADO por obrigação fiscal, e por quanto tempo. Não é comentário
 * solto: as constantes abaixo são usadas pelo caminho de exclusão e pelos
 * testes, então mudar a política exige mudar o código.
 *
 * ---------------------------------------------------------------------------
 * O contexto multi-tenant
 * ---------------------------------------------------------------------------
 * `User` é GLOBAL: o mesmo telefone faz OTP uma vez e é a mesma identidade em
 * todos os salões (`plano-refatoracao.md` §4). O vínculo do cliente com um
 * salão é o `TenantMember`. Portanto "excluir os dados do cliente NO SALÃO A"
 * não pode apagar o `User` enquanto ele ainda for cliente no salão B — isso
 * cascatearia (`tenant_member.user_id ON DELETE CASCADE`) e apagaria o vínculo
 * do salão B junto. A exclusão é, por definição, por tenant.
 *
 * ---------------------------------------------------------------------------
 * O que é APAGADO (não há base legal para reter)
 * ---------------------------------------------------------------------------
 * - `messaging_pref` do par (tenant, user): consentimento e opt-out daquele
 *   salão. Sem o vínculo, não há mais para que guardar.
 * - `user` (telefone, nome, e-mail): quando, depois de desvincular o salão, o
 *   titular NÃO tem nenhum outro vínculo. Aí a identidade deixa de ser
 *   necessária e some inteira — a FK em cascata cuida de `messaging_pref` e
 *   `otp_challenge`/`rate_limit_counter` são limpos pelo telefone.
 * - Quando o titular TEM vínculo com outro salão, o `user` real NÃO é tocado:
 *   apagá-lo destruiria o cadastro do outro estabelecimento. O salão que pediu
 *   a exclusão recebe um usuário anonimizado (abaixo).
 *
 * ---------------------------------------------------------------------------
 * O que é ANONIMIZADO (obrigação fiscal)
 * ---------------------------------------------------------------------------
 * - O `tenant_member` do salão é reapontado para um `user`-túmulo com nome
 *   "Cliente anonimizado" e telefone marcado como anonimizado. O agendamento
 *   pago continua no extrato, os pagamentos continuam somando, o histórico do
 *   profissional continua lá — o que sai é a PII.
 * - `booking`, `payment`, `membership` e `credit_ledger` NÃO são apagados nem
 *   alterados em valores: são o registro fiscal da operação. O nome e o
 *   telefone do cliente eram a única PII nesse caminho, e ela mora no `user`,
 *   que acabou de ser desvinculado.
 * - `audit_log` é append-only: nunca se apaga linha de auditoria. O vínculo do
 *   ator com o `user` real cai para nulo se a identidade for purgada
 *   (`ON DELETE SET NULL`), mas o rastro permanece.
 *
 * ---------------------------------------------------------------------------
 * Retenção
 * ---------------------------------------------------------------------------
 * O registro fiscal anonimizado é retido por `FISCAL_RETENTION_YEARS` anos
 * (prazo decadencial do Código Tributário Nacional, art. 173/174) e só depois
 * pode ser expurgado. Durante a retenção ele já não contém dado pessoal: a
 * anonimização é imediata, a retenção é do FATO contábil, não da pessoa.
 *
 * O isolamento continua valendo: a anonimização no salão A não altera uma linha
 * do salão B (testado em `tests/integration/privacy.test.ts`).
 */

export const FISCAL_RETENTION_YEARS = 5;

/** Nome do usuário-túmulo que substitui o titular no vínculo anonimizado. */
export const ANONYMIZED_CUSTOMER_NAME = 'Cliente anonimizado';

/**
 * Prefixo do telefone-túmulo. É DE PROPÓSITO fora de E.164: o runner de
 * mensagens só envia para telefone válido, então um cadastro anonimizado nunca
 * recebe mensagem — o efeito colateral de reaproveitar um número real seria
 * mandar WhatsApp para um estranho.
 */
export const ANONYMIZED_PHONE_PREFIX = 'anonimizado:';

export function anonymizedPhone(): string {
  return `${ANONYMIZED_PHONE_PREFIX}${randomUUID()}`;
}

export function isAnonymizedPhone(phone: string): boolean {
  return phone.startsWith(ANONYMIZED_PHONE_PREFIX);
}
