import { auditAction, recordAuditLog } from '@/lib/audit';
import { asPlatformAdmin, forTenant, type TenantTransaction } from '@/lib/tenant/db';
import { ANONYMIZED_CUSTOMER_NAME, anonymizedPhone, isAnonymizedPhone } from './policy';
import type { ErasureResult } from './types';

/**
 * Caminho de exclusão do titular (LGPD, tarefa F6.2). A política — o que é
 * apagado, o que é anonimizado e por quê — está registrada em `./policy.ts`.
 *
 * DUAS FASES, de propósito:
 *
 * 1. `eraseCustomerData` roda DENTRO da transação escopada do salão e é a parte
 *    atômica: desvincula o `TenantMember` do `User` real, apontando-o para um
 *    usuário anonimizado, e apaga o que só existia naquele vínculo
 *    (`messaging_pref`). O extrato (booking/payment/membership) permanece
 *    intacto e continua referenciando o mesmo `TenantMember` — nada quebra.
 *
 * 2. `purgeOrphanIdentity` roda no caminho de plataforma porque precisa
 *    responder uma pergunta que a RLS esconde: "este telefone ainda é cliente
 *    de outro salão?". Só quando a resposta é NÃO o `User` global é apagado.
 *    Se outro salão ainda depende da identidade, ele fica intocado e apenas o
 *    vínculo do salão que pediu a exclusão vira anônimo.
 *
 * O que NUNCA acontece: apagar `TenantMember` com agendamento (a FK é
 * `ON DELETE RESTRICT` e a constraint `booking_customer_required` exige cliente
 * fora de HOLD) ou apagar `Payment` (obrigação fiscal). Por isso o vínculo é
 * reapontado, não removido.
 */

export interface EraseCustomerDataInput {
  tenantId: string;
  tenantMemberId: string;
  /** Quem pediu a exclusão: o dono que opera o painel. `null` = ação do sistema. */
  actorId: string | null;
}

/**
 * Parte escopada ao tenant da exclusão. Devolve `null` quando o membro não
 * existe no salão, não é cliente, ou já está anonimizado — em todos os casos,
 * repetir a operação é inofensivo.
 */
export async function eraseCustomerData(
  tx: TenantTransaction,
  input: EraseCustomerDataInput,
): Promise<ErasureResult | null> {
  const member = await tx.tenantMember.findFirst({
    where: { id: input.tenantMemberId, tenantId: input.tenantId },
    select: { id: true, role: true, userId: true },
  });
  if (!member || member.role !== 'CUSTOMER') return null;

  const identity = await tx.user.findUnique({
    where: { id: member.userId },
    select: { id: true, phone: true },
  });
  if (!identity) return null;
  // Já anonimizado: não cria um segundo túmulo nem duplica o rastro.
  if (isAnonymizedPhone(identity.phone)) return null;

  const bookings = await tx.booking.count({
    where: { tenantId: input.tenantId, customerId: member.id },
  });
  const payments = await tx.payment.count({
    where: { tenantId: input.tenantId, booking: { customerId: member.id } },
  });
  const memberships = await tx.membership.count({
    where: { tenantId: input.tenantId, customerId: member.id },
  });
  const auditLogs = await tx.auditLog.count({
    where: { tenantId: input.tenantId, actorId: identity.id },
  });

  const deletedPrefs = await tx.messagingPref.deleteMany({
    where: { tenantId: input.tenantId, userId: identity.id },
  });

  const anonymized = await tx.user.create({
    data: { phone: anonymizedPhone(), name: ANONYMIZED_CUSTOMER_NAME },
    select: { id: true, phone: true },
  });

  await tx.tenantMember.update({
    where: { id: member.id },
    data: { userId: anonymized.id },
  });

  await recordAuditLog(tx, {
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: auditAction('customer', 'erase'),
    entity: 'TenantMember',
    entityId: member.id,
  });

  return {
    tenantId: input.tenantId,
    tenantMemberId: member.id,
    anonymizedUserId: anonymized.id,
    anonymizedPhone: anonymized.phone,
    identityUserId: identity.id,
    identityPhone: identity.phone,
    identityPurged: false,
    deleted: { messagingPrefs: deletedPrefs.count },
    retained: { bookings, payments, memberships, auditLogs },
    erasedAt: new Date(),
  };
}

/**
 * Apaga a identidade global quando ela ficou órfã. Atravessa tenants de
 * propósito — é a única forma de saber se o telefone ainda é cliente em outro
 * salão — e por isso passa por `asPlatformAdmin`, o bypass explícito da F0.2,
 * nunca por um client escopado que enxergaria um tenant só.
 *
 * Devolve `true` se o `User` foi apagado, `false` se outro vínculo o mantém.
 */
export async function purgeOrphanIdentity(identity: {
  userId: string;
  phone: string;
}): Promise<boolean> {
  return asPlatformAdmin(async (tx) => {
    const remaining = await tx.tenantMember.count({ where: { userId: identity.userId } });
    if (remaining > 0) return false;

    // Dado de autenticação ligado ao telefone não tem FK: some por consulta.
    await tx.rateLimitCounter.deleteMany({ where: { key: { contains: identity.phone } } });
    await tx.otpChallenge.deleteMany({ where: { phone: identity.phone } });
    await tx.user.delete({ where: { id: identity.userId } });
    return true;
  });
}

export interface EraseCustomerInput {
  tenantId: string;
  tenantMemberId: string;
  actorId: string | null;
}

/**
 * Orquestra as duas fases. A primeira é atômica; a segunda é idempotente e
 * segura sob concorrência (reconta os vínculos antes de apagar). O resultado
 * devolvido é o da fase escopada, com o desfecho da purga já resolvido.
 */
export async function eraseCustomer(input: EraseCustomerInput): Promise<ErasureResult | null> {
  const result = await forTenant(input.tenantId, (tx) => eraseCustomerData(tx, input));
  if (!result) return null;

  const purged = await purgeOrphanIdentity({
    userId: result.identityUserId,
    phone: result.identityPhone,
  });
  return { ...result, identityPurged: purged };
}
