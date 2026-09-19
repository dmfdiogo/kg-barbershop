import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookingStatus } from '@prisma/client';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { loadDashboard } from '@/app/(dashboard)/painel/inicio/data';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Dashboard operacional (tarefa F2.4), com Postgres real.
 *
 * Prova que os números batem com o dado: faturamento do dia/mês só de
 * CONFIRMED/COMPLETED, ocupação por profissional e agenda do dia no fuso do
 * tenant. O `now` é fixo (2026-11-03, uma terça em São Paulo) para não depender
 * do relógio da máquina nem do dia da semana corrente.
 */

const TZ = 'America/Sao_Paulo';
const SUFFIX = randomInt(0, 999_999).toString().padStart(6, '0');
const PHONES: string[] = [];

function nextPhone(): string {
  const phone = `+5548${SUFFIX}${String(PHONES.length).padStart(2, '0')}`;
  PHONES.push(phone);
  return phone;
}

interface TenantIds {
  tenantId: string;
  staffId: string;
  service30: string;
  service20: string;
  customerId: string;
}

describe('dashboard operacional', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenant: TenantIds;
  let isoTenant: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenant = await admin.asPlatformAdmin(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          slug: `inicio-${SUFFIX}`,
          name: `Painel Início ${SUFFIX}`,
          document: '12345678901',
          timezone: TZ,
          cancellationWindowHours: 24,
        },
        select: { id: true },
      });

      const staffUser = await tx.user.create({
        data: { phone: nextPhone(), name: 'Profissional Teste' },
      });
      const staffMember = await tx.tenantMember.create({
        data: { tenantId: created.id, userId: staffUser.id, role: 'STAFF' },
      });
      const staffProfile = await tx.staffProfile.create({
        data: { tenantId: created.id, tenantMemberId: staffMember.id },
      });
      // Terça (getDay() = 2): 09:00–18:00 = 540 minutos.
      await tx.workingHours.create({
        data: {
          tenantId: created.id,
          staffId: staffProfile.id,
          weekday: 2,
          startTime: new Date('1970-01-01T09:00:00.000Z'),
          endTime: new Date('1970-01-01T18:00:00.000Z'),
        },
      });

      const customerUser = await tx.user.create({
        data: { phone: nextPhone(), name: 'Cliente Teste' },
      });
      const customer = await tx.tenantMember.create({
        data: { tenantId: created.id, userId: customerUser.id, role: 'CUSTOMER' },
      });

      const service30 = await tx.service.create({
        data: {
          tenantId: created.id,
          name: 'Corte',
          durationMin: 30,
          bufferMin: 10,
          priceCents: 5000,
          paymentMode: 'ON_SITE',
        },
      });
      const service20 = await tx.service.create({
        data: {
          tenantId: created.id,
          name: 'Barba',
          durationMin: 20,
          bufferMin: 5,
          priceCents: 3500,
          paymentMode: 'ON_SITE',
        },
      });

      async function booking(input: {
        service: { id: string; durationMin: number; bufferMin: number };
        startsAt: string;
        status: BookingStatus;
        priceCents: number;
      }) {
        const startsAt = new Date(input.startsAt);
        const endsAt = new Date(startsAt.getTime() + input.service.durationMin * 60_000);
        const blockedUntil = new Date(endsAt.getTime() + input.service.bufferMin * 60_000);
        await tx.booking.create({
          data: {
            tenantId: created.id,
            customerId: customer.id,
            staffId: staffProfile.id,
            serviceId: input.service.id,
            startsAt,
            endsAt,
            blockedUntil,
            status: input.status,
            priceCents: input.priceCents,
            source: 'PORTAL',
          },
        });
      }

      // Dia local (2026-11-03): 10:00 e 13:00 BRT = 13:00 e 16:00 UTC.
      await booking({
        service: service30,
        startsAt: '2026-11-03T13:00:00.000Z',
        status: 'CONFIRMED',
        priceCents: 5000,
      });
      await booking({
        service: service20,
        startsAt: '2026-11-03T16:00:00.000Z',
        status: 'COMPLETED',
        priceCents: 3500,
      });
      // Cancelado no mesmo dia: fora da agenda e do faturamento.
      await booking({
        service: service30,
        startsAt: '2026-11-03T17:00:00.000Z',
        status: 'CANCELLED',
        priceCents: 9000,
      });
      // Mesmo mês, outro dia: entra no faturamento do mês, não no do dia.
      await booking({
        service: service30,
        startsAt: '2026-11-10T13:00:00.000Z',
        status: 'CONFIRMED',
        priceCents: 8000,
      });
      // Mês anterior: fora de tudo.
      await booking({
        service: service30,
        startsAt: '2026-10-20T13:00:00.000Z',
        status: 'CONFIRMED',
        priceCents: 10000,
      });

      return {
        tenantId: created.id,
        staffId: staffProfile.id,
        service30: service30.id,
        service20: service20.id,
        customerId: customer.id,
      };
    });

    isoTenant = await createTenantFixture(admin, 'inicio-b');
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenant) await deleteTenant(admin, tenant.tenantId);
      if (isoTenant) await deleteTenant(admin, isoTenant.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  it('faturamento do dia e do mês somam só CONFIRMED/COMPLETED', async () => {
    const overview = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadDashboard(tx, tenant.tenantId, TZ, new Date('2026-11-03T15:00:00.000Z')),
    );

    expect(overview.date).toBe('2026-11-03');
    expect(overview.revenue.dayCents).toBe(5000 + 3500);
    expect(overview.revenue.monthCents).toBe(5000 + 3500 + 8000);
  });

  it('a agenda do dia traz os atendimentos ordenados e ignora cancelados', async () => {
    const overview = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadDashboard(tx, tenant.tenantId, TZ, new Date('2026-11-03T15:00:00.000Z')),
    );

    expect(overview.agenda).toHaveLength(2);
    expect(overview.agenda.map((entry) => entry.status)).toEqual(['CONFIRMED', 'COMPLETED']);
    expect(overview.agenda[0]?.startsAt.toISOString()).toBe('2026-11-03T13:00:00.000Z');
    expect(overview.agenda[0]?.customerName).toBe('Cliente Teste');
    expect(overview.agenda[0]?.staffName).toBe('Profissional Teste');
    expect(overview.agenda[0]?.serviceName).toBe('Corte');
  });

  it('a ocupação é a razão entre minutos agendados e a jornada do dia', async () => {
    const overview = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadDashboard(tx, tenant.tenantId, TZ, new Date('2026-11-03T15:00:00.000Z')),
    );

    const row = overview.occupancy.find((entry) => entry.staffId === tenant.staffId);
    expect(row).toBeDefined();
    expect(row?.workingMinutes).toBe(540);
    expect(row?.bookedMinutes).toBe(50);
    expect(row?.rate).toBeCloseTo(50 / 540, 6);
  });

  it('sem jornada no dia, a ocupação é nula em vez de divisão por zero', async () => {
    const overview = await scoped.forTenant(tenant.tenantId, (tx) =>
      loadDashboard(tx, tenant.tenantId, TZ, new Date('2026-11-04T15:00:00.000Z')),
    );

    const row = overview.occupancy.find((entry) => entry.staffId === tenant.staffId);
    expect(row?.rate).toBeNull();
    expect(row?.bookedMinutes).toBe(0);
  });

  it('o dashboard de um tenant não enxerga o agendamento de outro (RLS)', async () => {
    const overview = await scoped.forTenant(isoTenant.tenantId, (tx) =>
      loadDashboard(tx, isoTenant.tenantId, TZ, new Date('2026-11-03T15:00:00.000Z')),
    );

    expect(overview.revenue.dayCents).toBe(0);
    expect(overview.revenue.monthCents).toBe(0);
    expect(overview.agenda).toHaveLength(0);
  });
});
