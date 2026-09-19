import type { MessagingChannel, NotificationStatus } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import { TEMPLATES, type JobTemplateName } from './templates';

/**
 * Preferências de mensageria, consentimento e opt-out (tarefa F6.2, fase-6 §4).
 *
 * A tabela `MessagingPref` é escopada por tenant (`tenantId, userId, channel`):
 * um cliente pode aceitar WhatsApp no salão A e ter pedido para não receber no
 * pet shop B. O opt-out é DESTE estabelecimento — não é uma preferência global
 * do telefone. É o mesmo princípio de `TenantMember`: cada relação é de um
 * salão, e a RLS garante que um não enxergue o outro.
 *
 * O QUE O OPT-OUT BLOQUEIA: mensagem promocional e de conveniência (os
 * lembretes D-1 e H-2). O QUE ELE NÃO BLOQUEIA: o transacional crítico — a
 * confirmação que o cliente acabou de pedir, o cancelamento e a remarcação do
 * agendamento dele. Recusar esses deixaria a pessoa sem saber que o horário
 * existe ou que mudou; a própria LGPD trata execução de contrato como base
 * legal independente do consentimento de marketing. O OTP também é
 * AUTHENTICATION e nunca passa por opt-out (não é `NotificationJob`).
 */

/** Canal padrão do produto no piloto: tudo o que existe hoje é WhatsApp. */
export const DEFAULT_MESSAGING_CHANNEL: MessagingChannel = 'WHATSAPP';

/**
 * Templates transacionais que o opt-out NÃO pode barrar. `otp_login` não
 * aparece porque nem é elegível a job; os três daqui são a confirmação do
 * próprio agendamento e os avisos de cancelamento/remarcação dele.
 *
 * Um template futuro só entra nesta lista se a mensagem for necessária para a
 * execução do serviço contratado. "Aviso de promoção" nunca entra.
 */
const OPT_OUT_EXEMPT_TEMPLATES: ReadonlySet<JobTemplateName> = new Set([
  'booking_confirmation',
  'booking_cancelled_customer',
  'booking_rescheduled_customer',
]);

/**
 * `true` quando a mensagem é de conveniência/promocional e pode ser barrada por
 * opt-out. Templates para o profissional (`STAFF`) nunca são afetados pela
 * preferência do cliente — o opt-out é do consumidor, não do salão.
 */
export function isOptOutableTemplate(template: JobTemplateName): boolean {
  return TEMPLATES[template].audience === 'CUSTOMER' && !OPT_OUT_EXEMPT_TEMPLATES.has(template);
}

export function isOptOutExemptTemplate(template: JobTemplateName): boolean {
  return !isOptOutableTemplate(template);
}

/** Projeção estável de uma preferência, sem vazar o modelo do Prisma para a UI. */
export interface MessagingPreferenceRecord {
  channel: MessagingChannel;
  optedOutAt: Date | null;
  consentAt: Date | null;
  consentSource: string | null;
}

function toRecord(row: {
  channel: MessagingChannel;
  optedOutAt: Date | null;
  consentAt: Date | null;
  consentSource: string | null;
}): MessagingPreferenceRecord {
  return {
    channel: row.channel,
    optedOutAt: row.optedOutAt,
    consentAt: row.consentAt,
    consentSource: row.consentSource,
  };
}

function prefKey(tenantId: string, userId: string, channel: MessagingChannel) {
  return { tenantId_userId_channel: { tenantId, userId, channel } };
}

export interface MessagingPreferenceInput {
  tenantId: string;
  userId: string;
  channel?: MessagingChannel;
}

/**
 * Registra o consentimento do titular: QUANDO (instante) e POR QUAL CANAL, e a
 * origem textual (`consentSource`) para a trilha de auditoria. Não mexe no
 * opt-out — consentir e pedir para parar são atos independentes; o histórico
 * dos dois fica preservado.
 *
 * Reexecutável: usa `upsert`, então um retry da transação escopada não duplica
 * nem perde o registro.
 */
export async function recordConsent(
  tx: TenantTransaction,
  input: MessagingPreferenceInput & { source: string; at?: Date },
): Promise<MessagingPreferenceRecord> {
  const channel = input.channel ?? DEFAULT_MESSAGING_CHANNEL;
  const at = input.at ?? new Date();

  const row = await tx.messagingPref.upsert({
    where: prefKey(input.tenantId, input.userId, channel),
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      channel,
      consentAt: at,
      consentSource: input.source,
    },
    update: { consentAt: at, consentSource: input.source },
  });
  return toRecord(row);
}

/** Marca o opt-out no canal. O consentimento histórico não é apagado. */
export async function setMessagingOptOut(
  tx: TenantTransaction,
  input: MessagingPreferenceInput & { at?: Date },
): Promise<MessagingPreferenceRecord> {
  const channel = input.channel ?? DEFAULT_MESSAGING_CHANNEL;
  const at = input.at ?? new Date();

  const row = await tx.messagingPref.upsert({
    where: prefKey(input.tenantId, input.userId, channel),
    create: { tenantId: input.tenantId, userId: input.userId, channel, optedOutAt: at },
    update: { optedOutAt: at },
  });
  return toRecord(row);
}

/**
 * Desfaz o opt-out e, no mesmo ato, registra o novo consentimento: voltar a
 * aceitar mensagens é consentir de novo, e a data/source precisam refletir isso.
 */
export async function clearMessagingOptOut(
  tx: TenantTransaction,
  input: MessagingPreferenceInput & { source: string; at?: Date },
): Promise<MessagingPreferenceRecord> {
  const channel = input.channel ?? DEFAULT_MESSAGING_CHANNEL;
  const at = input.at ?? new Date();

  const row = await tx.messagingPref.upsert({
    where: prefKey(input.tenantId, input.userId, channel),
    create: {
      tenantId: input.tenantId,
      userId: input.userId,
      channel,
      consentAt: at,
      consentSource: input.source,
    },
    update: { optedOutAt: null, consentAt: at, consentSource: input.source },
  });
  return toRecord(row);
}

export async function getMessagingPreference(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
  channel: MessagingChannel = DEFAULT_MESSAGING_CHANNEL,
): Promise<MessagingPreferenceRecord | null> {
  const row = await tx.messagingPref.findUnique({
    where: prefKey(tenantId, userId, channel),
  });
  return row ? toRecord(row) : null;
}

export async function isUserOptedOut(
  tx: TenantTransaction,
  tenantId: string,
  userId: string,
  channel: MessagingChannel = DEFAULT_MESSAGING_CHANNEL,
): Promise<boolean> {
  const row = await tx.messagingPref.findUnique({
    where: prefKey(tenantId, userId, channel),
    select: { optedOutAt: true },
  });
  return Boolean(row?.optedOutAt);
}

/**
 * Caminho usado pelo runner de jobs: o agendamento guarda o `TenantMember` do
 * cliente, não o `User` global. Resolver o `userId` aqui mantém a preferência
 * escopada ao tenant corrente — o mesmo telefone pode ter outra preferência em
 * outro salão.
 */
export async function isTenantMemberOptedOut(
  tx: TenantTransaction,
  tenantId: string,
  tenantMemberId: string,
  channel: MessagingChannel = DEFAULT_MESSAGING_CHANNEL,
): Promise<boolean> {
  const member = await tx.tenantMember.findFirst({
    where: { id: tenantMemberId, tenantId },
    select: { userId: true },
  });
  if (!member) return false;
  return isUserOptedOut(tx, tenantId, member.userId, channel);
}

// ---------------------------------------------------------------------------
// Visão do painel (tarefa F6.2): preferências + log de entrega
// ---------------------------------------------------------------------------

export interface MessagingCustomerView {
  memberId: string;
  userId: string;
  name: string;
  phone: string;
  channel: MessagingChannel;
  optedOut: boolean;
  consentAt: Date | null;
  consentSource: string | null;
}

export interface MessagingDeliveryView {
  id: string;
  template: string;
  status: NotificationStatus;
  attempts: number;
  providerMessageId: string | null;
  sentAt: Date | null;
  /** Motivo da falha/recusa — é o que explica "o cliente diz que não recebeu". */
  lastError: string | null;
  createdAt: Date;
  customerMemberId: string | null;
  customerName: string | null;
}

export interface MessagingOverview {
  channel: MessagingChannel;
  customers: MessagingCustomerView[];
  deliveries: MessagingDeliveryView[];
  stats: { optedOut: number; sent: number; failed: number; pending: number };
}

/**
 * Monta a tela de mensagens com UMA travessia escopada: clientes e preferências,
 * log de entrega recente e um resumo. Tudo passa pela transação do tenant, então
 * o painel de um salão nunca enxerga job nem preferência de outro.
 */
export async function listMessagingOverview(
  tx: TenantTransaction,
  tenantId: string,
  options: { deliveryLimit?: number } = {},
): Promise<MessagingOverview> {
  const limit = options.deliveryLimit ?? 50;
  const channel = DEFAULT_MESSAGING_CHANNEL;

  const members = await tx.tenantMember.findMany({
    where: { tenantId, role: 'CUSTOMER' },
    select: { id: true, userId: true, user: { select: { name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const prefs = await tx.messagingPref.findMany({
    where: { tenantId, channel },
    select: { userId: true, optedOutAt: true, consentAt: true, consentSource: true },
  });
  const prefByUser = new Map(prefs.map((pref) => [pref.userId, pref]));

  const customers: MessagingCustomerView[] = members.map((member) => {
    const pref = prefByUser.get(member.userId);
    return {
      memberId: member.id,
      userId: member.userId,
      name: member.user.name,
      phone: member.user.phone,
      channel,
      optedOut: Boolean(pref?.optedOutAt),
      consentAt: pref?.consentAt ?? null,
      consentSource: pref?.consentSource ?? null,
    };
  });

  const jobs = await tx.notificationJob.findMany({
    where: { tenantId },
    select: {
      id: true,
      template: true,
      status: true,
      attempts: true,
      providerMessageId: true,
      sentAt: true,
      lastError: true,
      createdAt: true,
      booking: { select: { customerId: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const nameByMember = new Map(customers.map((customer) => [customer.memberId, customer.name]));
  const deliveries: MessagingDeliveryView[] = jobs.map((job) => {
    const customerMemberId = job.booking?.customerId ?? null;
    return {
      id: job.id,
      template: job.template,
      status: job.status,
      attempts: job.attempts,
      providerMessageId: job.providerMessageId,
      sentAt: job.sentAt,
      lastError: job.lastError,
      createdAt: job.createdAt,
      customerMemberId,
      customerName: customerMemberId ? (nameByMember.get(customerMemberId) ?? null) : null,
    };
  });

  return {
    channel,
    customers,
    deliveries,
    stats: {
      optedOut: customers.filter((customer) => customer.optedOut).length,
      sent: deliveries.filter((delivery) => delivery.status === 'SENT').length,
      failed: deliveries.filter((delivery) => delivery.status === 'FAILED').length,
      pending: deliveries.filter((delivery) => delivery.status === 'PENDING').length,
    },
  };
}
