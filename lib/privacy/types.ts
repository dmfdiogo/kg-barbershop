import type {
  BookingStatus,
  MemberRole,
  MembershipStatus,
  MessagingChannel,
  NotificationStatus,
  PaymentMethod,
  PaymentStatus,
} from '@prisma/client';

/**
 * Contratos de exportação e exclusão de dados do titular (tarefa F6.2).
 */

/** Quanto de cada entidade o salão mantém após a anonimização (extrato fiscal). */
export interface ErasureRetained {
  bookings: number;
  payments: number;
  memberships: number;
  auditLogs: number;
}

export interface ErasureResult {
  tenantId: string;
  /** `TenantMember` que foi anonimizado. */
  tenantMemberId: string;
  /** `User`-túmulo para o qual o vínculo passou a apontar. */
  anonymizedUserId: string;
  anonymizedPhone: string;
  /** Identidade global antes da exclusão (o `phone` é o que orienta a purga). */
  identityUserId: string;
  identityPhone: string;
  /**
   * `true` quando o titular não tinha vínculo com outro salão e o `user` real
   * foi apagado. `false` quando outro salão ainda depende dele — nesse caso só o
   * vínculo DESTE salão foi anonimizado.
   */
  identityPurged: boolean;
  deleted: { messagingPrefs: number };
  retained: ErasureRetained;
  erasedAt: Date;
}

export interface CustomerDataExport {
  exportedAt: string;
  tenant: { id: string; name: string };
  subject: {
    memberId: string;
    userId: string;
    role: MemberRole;
    memberSince: string;
    name: string;
    phone: string;
    email: string | null;
    userCreatedAt: string;
  };
  bookings: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    status: BookingStatus;
    priceCents: number;
    serviceName: string | null;
    staffName: string | null;
    source: string;
    createdAt: string;
    cancelledAt: string | null;
    cancellationReason: string | null;
  }>;
  payments: Array<{
    id: string;
    bookingId: string;
    method: PaymentMethod;
    status: PaymentStatus;
    amountCents: number;
    paidAt: string | null;
    createdAt: string;
  }>;
  memberships: Array<{
    id: string;
    planName: string;
    status: MembershipStatus;
    currentPeriodEnd: string | null;
    createdAt: string;
  }>;
  messaging: Array<{
    channel: MessagingChannel;
    optedOutAt: string | null;
    consentAt: string | null;
    consentSource: string | null;
  }>;
  notifications: Array<{
    id: string;
    template: string;
    status: NotificationStatus;
    sentAt: string | null;
    providerMessageId: string | null;
    lastError: string | null;
    createdAt: string;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    createdAt: string;
  }>;
}
