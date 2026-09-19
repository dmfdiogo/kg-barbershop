import type { BookingStatus, KycStatus, SubscriptionStatus, TenantStatus } from '@prisma/client';
import { auditAction, withPlatformAudit } from '@/lib/audit';
import { requireSuperAdmin } from '@/lib/auth/rbac';
import type { BillingPlanCode } from '@/lib/billing/plans';
import { asPlatformAdmin, type TenantTransaction } from '@/lib/tenant/db';

/**
 * Contexto de UM tenant para suporte (tarefa F7.3).
 *
 * ESTE É O ACESSO QUE DEIXA RASTRO. Diferente do diretório global
 * (`lib/platform/overview.ts`), abrir a ficha de um salão é olhar o dado de
 * negócio daquele cliente específico: clientes, agendamentos, assinatura, conta
 * de recebimento. Todo caminho passa por `withPlatformAudit()`, que revalida
 * `User.isSuperAdmin` e commita o `AuditLog` ANTES da leitura — a linha registra
 * a TENTATIVA, então nem uma leitura que falhe depois apaga o rastro.
 *
 * A checagem de existência roda ANTES do `withPlatformAudit` de propósito.
 * `audit_log.tenant_id` é FK de `tenant`: registrar o acesso a um id que não
 * existe violaria a constraint e viraria 500 em vez do 404 do segmento. A
 * checagem usa a projeção mais estreita possível (`id`) e revalida o portão
 * primeiro — um owner comum é negado antes mesmo de descobrir se o id existe.
 *
 * O que NUNCA sai daqui: `AsaasAccount.apiKeyEnc` (chave da subconta). A ficha
 * de suporte precisa do estado do KYC, não da credencial.
 */

/** Linha de agendamento recente exibida no suporte, já normalizada. */
export interface SupportBooking {
  id: string;
  startsAt: Date;
  status: BookingStatus;
  priceCents: number;
  customerName: string | null;
  serviceName: string;
}

export interface SupportAuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  actorId: string | null;
  createdAt: Date;
}

export interface TenantSupportContext {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: TenantStatus;
    timezone: string;
    customDomain: string | null;
    createdAt: Date;
    trialBookingsUsed: number;
  };
  subscription: {
    plan: BillingPlanCode;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    trialEndedAt: Date | null;
  } | null;
  receivingAccount: {
    kycStatus: KycStatus;
    pixKey: string;
    asaasAccountId: string;
  } | null;
  usage: {
    activeAgendas: number;
    totalBookings: number;
    upcomingBookings: number;
  };
  recentBookings: SupportBooking[];
  /** Últimas linhas de auditoria do tenant — inclui o acesso de agora. */
  recentAuditLogs: SupportAuditEntry[];
}

/** Existe um tenant com este id? Projeção mínima, sem dado de negócio. */
async function tenantExists(tenantId: string): Promise<boolean> {
  const row = await asPlatformAdmin((tx) =>
    tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } }),
  );
  return row !== null;
}

async function loadSupportContext(
  tx: TenantTransaction,
  tenantId: string,
): Promise<TenantSupportContext | null> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      timezone: true,
      customDomain: true,
      createdAt: true,
      trialBookingsUsed: true,
      platformSub: {
        select: {
          plan: true,
          status: true,
          currentPeriodEnd: true,
          trialEndedAt: true,
        },
      },
      asaasAccount: { select: { kycStatus: true, pixKey: true, asaasAccountId: true } },
    },
  });
  if (!tenant) return null;

  // Consultas SEQUENCIAIS de propósito: o adapter-pg não gosta de queries
  // concorrentes na mesma transação interativa (nota em lib/tenant/db.ts).
  const activeAgendas = await tx.staffProfile.count({ where: { tenantId, active: true } });
  const totalBookings = await tx.booking.count({ where: { tenantId } });
  const upcomingBookings = await tx.booking.count({
    where: {
      tenantId,
      startsAt: { gte: new Date() },
      status: { in: ['PENDING', 'CONFIRMED'] },
    },
  });
  const recentBookings = await tx.booking.findMany({
    where: { tenantId },
    orderBy: { startsAt: 'desc' },
    take: 10,
    select: {
      id: true,
      startsAt: true,
      status: true,
      priceCents: true,
      customer: { select: { user: { select: { name: true } } } },
      service: { select: { name: true } },
    },
  });
  const recentAuditLogs = await tx.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      action: true,
      entity: true,
      entityId: true,
      actorId: true,
      createdAt: true,
    },
  });

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      timezone: tenant.timezone,
      customDomain: tenant.customDomain,
      createdAt: tenant.createdAt,
      trialBookingsUsed: tenant.trialBookingsUsed,
    },
    subscription: tenant.platformSub
      ? {
          plan: tenant.platformSub.plan,
          status: tenant.platformSub.status,
          currentPeriodEnd: tenant.platformSub.currentPeriodEnd,
          trialEndedAt: tenant.platformSub.trialEndedAt,
        }
      : null,
    receivingAccount: tenant.asaasAccount
      ? {
          kycStatus: tenant.asaasAccount.kycStatus,
          pixKey: tenant.asaasAccount.pixKey,
          asaasAccountId: tenant.asaasAccount.asaasAccountId,
        }
      : null,
    usage: { activeAgendas, totalBookings, upcomingBookings },
    recentBookings: recentBookings.map((booking) => ({
      id: booking.id,
      startsAt: booking.startsAt,
      status: booking.status,
      priceCents: booking.priceCents,
      customerName: booking.customer?.user.name ?? null,
      serviceName: booking.service.name,
    })),
    recentAuditLogs,
  };
}

/**
 * Abre a ficha de suporte de um tenant. Devolve `null` para id inexistente — o
 * chamador decide (a página lança `notFound()`). Toda chamada bem-sucedida deixa
 * uma linha `tenant.support_access` no `AuditLog` daquele tenant, com o
 * `actorId` do Super Admin lido da sessão.
 */
export async function getTenantSupportContext(
  tenantId: string,
): Promise<TenantSupportContext | null> {
  // Portão ANTES da sondagem de existência: owner comum não descobre nem se o
  // id existe.
  await requireSuperAdmin();

  if (!(await tenantExists(tenantId))) return null;

  return withPlatformAudit(
    {
      tenantId,
      action: auditAction('Tenant', 'support_access'),
      entity: 'Tenant',
      entityId: tenantId,
    },
    (tx) => loadSupportContext(tx, tenantId),
  );
}
