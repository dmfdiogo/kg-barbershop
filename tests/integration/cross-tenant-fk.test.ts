// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  type TenantFixture,
} from './helpers/test-database';

/**
 * TERCEIRA CAMADA DE ISOLAMENTO: a chave estrangeira carrega o `tenant_id`.
 *
 * As duas primeiras camadas — client escopado e RLS — protegem a LEITURA e a
 * escrita do `tenant_id` da própria linha. Nenhuma das duas olha a PROCEDÊNCIA
 * do id referenciado: a checagem de FK do Postgres roda como dono da tabela e
 * ignora RLS por completo. Antes das chaves compostas, uma linha
 * `(tenant_id = A, service_id = <serviço de B>)` era aceita pelo banco.
 *
 * Não é hipotético: o id do serviço trafega em formulário
 * (`/agendar?servico=…`) e o portal de qualquer salão é público, então o id do
 * vizinho nunca foi segredo. A validação na aplicação barra hoje; este teste
 * prova que, se ela falhar amanhã, o banco recusa.
 *
 * O teste roda como PLATFORM ADMIN de propósito — sem escopo de tenant, sem
 * RLS atrapalhando. É o cenário mais permissivo possível: se nem assim passa,
 * não passa em lugar nenhum.
 */

describe('FK escopada por tenant', () => {
  let admin: TenantDb;
  let a: TenantFixture;
  let b: TenantFixture;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    a = await createTenantFixture(admin, 'fk-a');
    b = await createTenantFixture(admin, 'fk-b');
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (a) await deleteTenant(admin, a.tenantId);
      if (b) await deleteTenant(admin, b.tenantId);
      await admin.disconnect();
    }
  });

  it('o banco recusa agendamento do tenant A apontando para serviço do tenant B', async () => {
    const startsAt = new Date(Date.UTC(2028, 5, 1, 12, 0, 0));

    await expect(
      admin.asPlatformAdmin((tx) =>
        tx.booking.create({
          data: {
            tenantId: a.tenantId,
            customerId: a.customerMemberId,
            staffId: a.staffId,
            // O serviço é do OUTRO salão.
            serviceId: b.serviceId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
            status: 'PENDING',
            priceCents: 5000,
            source: 'PORTAL',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('o banco recusa agendamento do tenant A com profissional do tenant B', async () => {
    const startsAt = new Date(Date.UTC(2028, 5, 2, 12, 0, 0));

    await expect(
      admin.asPlatformAdmin((tx) =>
        tx.booking.create({
          data: {
            tenantId: a.tenantId,
            customerId: a.customerMemberId,
            staffId: b.staffId,
            serviceId: a.serviceId,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 30 * 60_000),
            blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
            status: 'PENDING',
            priceCents: 5000,
            source: 'PORTAL',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('o banco recusa benefício de clube apontando para serviço de outro tenant', async () => {
    // É o caso que o agente da F5.0 reportou como furo, e que motivou a
    // varredura do schema inteiro.
    await expect(
      admin.asPlatformAdmin(async (tx) => {
        const plan = await tx.membershipPlan.create({
          data: { tenantId: a.tenantId, name: 'Clube A', priceCents: 5000, cycle: 'MONTHLY' },
        });
        return tx.membershipBenefit.create({
          data: {
            tenantId: a.tenantId,
            planId: plan.id,
            serviceId: b.serviceId,
            quantityPerCycle: 1,
          },
        });
      }),
    ).rejects.toThrow();
  });

  it('a mesma escrita, dentro do próprio tenant, continua passando', async () => {
    const startsAt = new Date(Date.UTC(2028, 5, 3, 12, 0, 0));

    const booking = await admin.asPlatformAdmin((tx) =>
      tx.booking.create({
        data: {
          tenantId: a.tenantId,
          customerId: a.customerMemberId,
          staffId: a.staffId,
          serviceId: a.serviceId,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          blockedUntil: new Date(startsAt.getTime() + 40 * 60_000),
          status: 'PENDING',
          priceCents: 5000,
          source: 'PORTAL',
        },
        select: { id: true },
      }),
    );

    expect(booking.id).toBeTruthy();
  });
});
