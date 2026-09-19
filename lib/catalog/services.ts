import type { Prisma } from '@prisma/client';
import type { TenantTransaction } from '@/lib/tenant/db';
import {
  OCCUPYING_BOOKING_STATUSES,
  type ServiceDeletionAssessment,
  type ServiceDeletionResult,
  type ServiceView,
  type StaffOption,
  type ValidatedService,
} from './types';

/**
 * Núcleo de dados do catálogo de serviços (tarefa F2.1).
 *
 * Funções puras de banco: recebem uma transação JÁ escopada pelo tenant
 * (`context.forTenant`) e o `tenantId`. Não abrem transação, não conhecem
 * `next/headers` e não chamam provider externo — assim são reexecutáveis sob
 * retry (invariante do client escopado) e testáveis sem runtime do Next.
 *
 * Toda query carrega `tenantId` explícito, mesmo quando a RLS já cobriria: é a
 * camada de aplicação do isolamento, e a segunda camada (RLS) continua valendo
 * por cima.
 */

const SERVICE_SELECT = {
  id: true,
  name: true,
  durationMin: true,
  bufferMin: true,
  priceCents: true,
  paymentMode: true,
  depositCents: true,
  depositPercent: true,
  active: true,
  staffServices: { select: { staffId: true } },
} satisfies Prisma.ServiceSelect;

type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_SELECT }>;

function toServiceView(row: ServiceRow): ServiceView {
  return {
    id: row.id,
    name: row.name,
    durationMin: row.durationMin,
    bufferMin: row.bufferMin,
    priceCents: row.priceCents,
    paymentMode: row.paymentMode,
    depositCents: row.depositCents,
    depositPercent: row.depositPercent,
    active: row.active,
    staffIds: row.staffServices.map((link) => link.staffId),
  };
}

function writableData(input: ValidatedService) {
  return {
    name: input.name,
    durationMin: input.durationMin,
    bufferMin: input.bufferMin,
    priceCents: input.priceCents,
    paymentMode: input.paymentMode,
    depositCents: input.depositCents,
    depositPercent: input.depositPercent,
    active: input.active,
  };
}

/**
 * Sincroniza os profissionais habilitados. Apaga e recria os vínculos em vez de
 * diferenciar: o volume é pequeno e o resultado fica idempotente sob retry.
 * Ids que não pertencem ao tenant (ou não existem) são descartados — um id de
 * outro salão não vira vínculo.
 */
async function syncStaff(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
  staffIds: readonly string[],
): Promise<void> {
  await tx.staffService.deleteMany({ where: { tenantId, serviceId } });
  if (staffIds.length === 0) return;

  const staff = await tx.staffProfile.findMany({
    where: { tenantId, id: { in: [...staffIds] } },
    select: { id: true },
  });
  if (staff.length === 0) return;

  await tx.staffService.createMany({
    data: staff.map((profile) => ({ tenantId, serviceId, staffId: profile.id })),
    skipDuplicates: true,
  });
}

export async function listServices(
  tx: TenantTransaction,
  tenantId: string,
): Promise<ServiceView[]> {
  const rows = await tx.service.findMany({
    where: { tenantId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: SERVICE_SELECT,
  });
  return rows.map(toServiceView);
}

export async function getService(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
): Promise<ServiceView | null> {
  const row = await tx.service.findFirst({
    where: { id: serviceId, tenantId },
    select: SERVICE_SELECT,
  });
  return row ? toServiceView(row) : null;
}

export async function listTenantStaff(
  tx: TenantTransaction,
  tenantId: string,
): Promise<StaffOption[]> {
  const rows = await tx.staffProfile.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      active: true,
      tenantMember: { select: { user: { select: { name: true } } } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.tenantMember.user.name,
    active: row.active,
  }));
}

export async function createService(
  tx: TenantTransaction,
  tenantId: string,
  input: ValidatedService,
): Promise<ServiceView> {
  const created = await tx.service.create({
    data: { tenantId, ...writableData(input) },
    select: { id: true },
  });
  await syncStaff(tx, tenantId, created.id, input.staffIds);
  const view = await getService(tx, tenantId, created.id);
  if (!view) throw new Error('Serviço recém-criado não encontrado');
  return view;
}

/** Devolve `null` quando o serviço não existe NESTE tenant (não vaza existência). */
export async function updateService(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
  input: ValidatedService,
): Promise<ServiceView | null> {
  const existing = await tx.service.findFirst({
    where: { id: serviceId, tenantId },
    select: { id: true },
  });
  if (!existing) return null;

  await tx.service.update({
    where: { id: serviceId },
    data: writableData(input),
  });
  await syncStaff(tx, tenantId, serviceId, input.staffIds);
  return getService(tx, tenantId, serviceId);
}

export async function setServiceActive(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
  active: boolean,
): Promise<boolean> {
  const result = await tx.service.updateMany({
    where: { id: serviceId, tenantId },
    data: { active },
  });
  return result.count > 0;
}

/**
 * Diagnóstico de exclusão. Excluir um serviço NÃO apaga quem já reservou: a FK
 * `booking -> service` é `ON DELETE RESTRICT` de propósito. Se há agendamento
 * futuro em status que ocupa a agenda, a saída é DESATIVAR. Se há apenas
 * histórico, excluir também é recusado — o histórico é do cliente, não do
 * catálogo.
 */
export async function assessServiceDeletion(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<ServiceDeletionAssessment | null> {
  const service = await tx.service.findFirst({
    where: { id: serviceId, tenantId },
    select: { id: true },
  });
  if (!service) return null;

  // Sequencial de propósito: o adapter-pg não gosta de queries concorrentes na
  // mesma transação interativa (nota em lib/tenant/db.ts).
  const totalBookings = await tx.booking.count({ where: { tenantId, serviceId } });
  const futureBookings = await tx.booking.count({
    where: {
      tenantId,
      serviceId,
      startsAt: { gte: now },
      status: { in: [...OCCUPYING_BOOKING_STATUSES] },
    },
  });

  if (futureBookings > 0) {
    return { canDelete: false, code: 'HAS_FUTURE_BOOKINGS', totalBookings, futureBookings };
  }
  if (totalBookings > 0) {
    return { canDelete: false, code: 'HAS_HISTORY', totalBookings, futureBookings: 0 };
  }
  return { canDelete: true, totalBookings: 0, futureBookings: 0 };
}

export async function deleteService(
  tx: TenantTransaction,
  tenantId: string,
  serviceId: string,
  now: Date = new Date(),
): Promise<ServiceDeletionResult> {
  const assessment = await assessServiceDeletion(tx, tenantId, serviceId, now);
  if (!assessment) {
    return { ok: false, code: 'NOT_FOUND', totalBookings: 0, futureBookings: 0 };
  }
  if (!assessment.canDelete) {
    return {
      ok: false,
      code: assessment.code,
      totalBookings: assessment.totalBookings,
      futureBookings: assessment.futureBookings,
    };
  }

  await tx.service.delete({ where: { id: serviceId } });
  return { ok: true };
}
