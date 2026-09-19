import type { TenantTransaction } from '@/lib/tenant/db';
import type { CustomerDataExport } from './types';

/**
 * Exportação dos dados do titular (direito de acesso, LGPD — tarefa F6.2).
 *
 * Devolve TUDO o que o salão guarda sobre aquela pessoa, em formato portátil
 * (JSON): identidade, agendamentos, pagamentos, clube, preferências de
 * mensageria, log de entrega e as linhas de auditoria em que ela foi o ator.
 *
 * TUDO passa pela transação escopada do tenant: por mais que `User` seja
 * global, as consultas de negócio são filtradas por `tenantId` e a RLS reforça.
 * A exportação do salão A nunca inclui um agendamento feito no salão B, mesmo
 * que o telefone seja o mesmo. É o §9.3 da spec virado em código.
 *
 * Devolve `null` quando o membro não existe NESTE tenant — o chamador traduz
 * em 404, nunca em "exportação de outro salão".
 */
export async function exportCustomerData(
  tx: TenantTransaction,
  tenantId: string,
  tenantMemberId: string,
): Promise<CustomerDataExport | null> {
  const member = await tx.tenantMember.findFirst({
    where: { id: tenantMemberId, tenantId },
    select: {
      id: true,
      userId: true,
      role: true,
      createdAt: true,
      user: {
        select: { name: true, phone: true, email: true, createdAt: true },
      },
    },
  });
  if (!member) return null;

  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true },
  });
  if (!tenant) return null;

  const bookings = await tx.booking.findMany({
    where: { tenantId, customerId: member.id },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      priceCents: true,
      serviceId: true,
      staffId: true,
      source: true,
      createdAt: true,
      cancelledAt: true,
      cancellationReason: true,
    },
    orderBy: { startsAt: 'desc' },
  });

  const [services, staffProfiles] = await Promise.all([
    tx.service.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    tx.staffProfile.findMany({
      where: { tenantId },
      select: { id: true, tenantMember: { select: { user: { select: { name: true } } } } },
    }),
  ]);
  const serviceName = new Map(services.map((service) => [service.id, service.name]));
  const staffName = new Map(
    staffProfiles.map((profile) => [profile.id, profile.tenantMember.user.name]),
  );

  const payments = await tx.payment.findMany({
    where: { tenantId, booking: { customerId: member.id } },
    select: {
      id: true,
      bookingId: true,
      method: true,
      status: true,
      amountCents: true,
      paidAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const memberships = await tx.membership.findMany({
    where: { tenantId, customerId: member.id },
    select: {
      id: true,
      status: true,
      currentPeriodEnd: true,
      createdAt: true,
      plan: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const messaging = await tx.messagingPref.findMany({
    where: { tenantId, userId: member.userId },
    select: { channel: true, optedOutAt: true, consentAt: true, consentSource: true },
    orderBy: { channel: 'asc' },
  });

  const notifications = await tx.notificationJob.findMany({
    where: { tenantId, booking: { customerId: member.id } },
    select: {
      id: true,
      template: true,
      status: true,
      sentAt: true,
      providerMessageId: true,
      lastError: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const auditLogs = await tx.auditLog.findMany({
    where: { tenantId, actorId: member.userId },
    select: { id: true, action: true, entity: true, entityId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

  return {
    exportedAt: new Date().toISOString(),
    tenant,
    subject: {
      memberId: member.id,
      userId: member.userId,
      role: member.role,
      memberSince: member.createdAt.toISOString(),
      name: member.user.name,
      phone: member.user.phone,
      email: member.user.email,
      userCreatedAt: member.user.createdAt.toISOString(),
    },
    bookings: bookings.map((booking) => ({
      id: booking.id,
      startsAt: booking.startsAt.toISOString(),
      endsAt: booking.endsAt.toISOString(),
      status: booking.status,
      priceCents: booking.priceCents,
      serviceName: serviceName.get(booking.serviceId) ?? null,
      staffName: staffName.get(booking.staffId) ?? null,
      source: booking.source,
      createdAt: booking.createdAt.toISOString(),
      cancelledAt: iso(booking.cancelledAt),
      cancellationReason: booking.cancellationReason,
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      bookingId: payment.bookingId,
      method: payment.method,
      status: payment.status,
      amountCents: payment.amountCents,
      paidAt: iso(payment.paidAt),
      createdAt: payment.createdAt.toISOString(),
    })),
    memberships: memberships.map((membership) => ({
      id: membership.id,
      planName: membership.plan.name,
      status: membership.status,
      currentPeriodEnd: iso(membership.currentPeriodEnd),
      createdAt: membership.createdAt.toISOString(),
    })),
    messaging: messaging.map((pref) => ({
      channel: pref.channel,
      optedOutAt: iso(pref.optedOutAt),
      consentAt: iso(pref.consentAt),
      consentSource: pref.consentSource,
    })),
    notifications: notifications.map((job) => ({
      id: job.id,
      template: job.template,
      status: job.status,
      sentAt: iso(job.sentAt),
      providerMessageId: job.providerMessageId,
      lastError: job.lastError,
      createdAt: job.createdAt.toISOString(),
    })),
    auditLogs: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entity: log.entity,
      entityId: log.entityId,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}
