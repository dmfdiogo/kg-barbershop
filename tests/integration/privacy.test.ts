// @vitest-environment node
import { randomInt } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ANONYMIZED_CUSTOMER_NAME,
  ANONYMIZED_PHONE_PREFIX,
  eraseCustomer,
  exportCustomerData,
} from '@/lib/privacy';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from './helpers/test-database';

/**
 * Direitos do titular (LGPD, tarefa F6.2) contra Postgres real e a role SEM
 * superuser, para que a RLS valha:
 *
 *   - exportação devolve só o dado do salão que atende o pedido;
 *   - exclusão anonimiza o vínculo sem tocar no extrato (booking/payment);
 *   - a identidade global é apagada quando órfã, e preservada quando outro
 *     salão ainda depende dela — esse é o ponto que o modelo multi-tenant
 *     torna difícil, e o teste que o trava.
 */

describe('direitos do titular', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  const createdTenants: string[] = [];

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());
  }, 180_000);

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenantId = createdTenants.pop();
      if (tenantId) await deleteTenant(admin, tenantId);
    }
  });

  afterAll(async () => {
    if (admin) {
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  async function makeTenant(prefix: string): Promise<TenantFixture> {
    const fixture = await createTenantFixture(admin, prefix);
    createdTenants.push(fixture.tenantId);
    return fixture;
  }

  async function userIdOf(tenantMemberId: string): Promise<string> {
    const member = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({ where: { id: tenantMemberId }, select: { userId: true } }),
    );
    return member!.userId;
  }

  describe('exportação', () => {
    it('traz o que é daquele salão e só isso', async () => {
      const a = await makeTenant('privacy-export-a');
      const b = await makeTenant('privacy-export-b');

      const data = await scoped.forTenant(a.tenantId, (tx) =>
        exportCustomerData(tx, a.tenantId, a.customerMemberId),
      );

      expect(data).not.toBeNull();
      const bookingIds = data!.bookings.map((booking) => booking.id);
      expect(bookingIds).toContain(a.bookingId);
      expect(bookingIds).not.toContain(b.bookingId);
      expect(data!.subject.memberId).toBe(a.customerMemberId);
    });

    it('não exporta membro de outro salão (404 no chamador)', async () => {
      const a = await makeTenant('privacy-export-cross');
      const b = await makeTenant('privacy-export-cross-b');

      const cross = await scoped.forTenant(a.tenantId, (tx) =>
        exportCustomerData(tx, a.tenantId, b.customerMemberId),
      );
      expect(cross).toBeNull();
    });
  });

  describe('exclusão', () => {
    it('anonimiza sem quebrar o extrato e apaga a identidade órfã', async () => {
      const fixture = await makeTenant('privacy-erase');
      const userId = await userIdOf(fixture.customerMemberId);

      await admin.forTenant(fixture.tenantId, (tx) =>
        tx.payment.create({
          data: {
            tenantId: fixture.tenantId,
            bookingId: fixture.bookingId,
            provider: 'mock',
            method: 'PIX',
            amountCents: 5000,
            status: 'PAID',
            paidAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        }),
      );
      await admin.forTenant(fixture.tenantId, (tx) =>
        tx.messagingPref.create({
          data: {
            tenantId: fixture.tenantId,
            userId,
            channel: 'WHATSAPP',
            optedOutAt: new Date(),
          },
        }),
      );

      const result = await eraseCustomer({
        tenantId: fixture.tenantId,
        tenantMemberId: fixture.customerMemberId,
        actorId: null,
      });

      expect(result).not.toBeNull();
      expect(result!.identityPurged).toBe(true);
      expect(result!.deleted.messagingPrefs).toBe(1);
      expect(result!.retained.bookings).toBe(1);
      expect(result!.retained.payments).toBe(1);
      expect(result!.anonymizedPhone.startsWith(ANONYMIZED_PHONE_PREFIX)).toBe(true);

      // Extrato intacto: o agendamento e o pagamento continuam lá.
      const booking = await admin.forTenant(fixture.tenantId, (tx) =>
        tx.booking.findUnique({ where: { id: fixture.bookingId } }),
      );
      expect(booking?.customerId).toBe(fixture.customerMemberId);

      const payment = await admin.forTenant(fixture.tenantId, (tx) =>
        tx.payment.findFirst({
          where: { tenantId: fixture.tenantId, bookingId: fixture.bookingId },
        }),
      );
      expect(payment?.status).toBe('PAID');

      // O vínculo passou a apontar para o túmulo.
      const member = await admin.forTenant(fixture.tenantId, (tx) =>
        tx.tenantMember.findUnique({
          where: { id: fixture.customerMemberId },
          include: { user: true },
        }),
      );
      expect(member?.user.name).toBe(ANONYMIZED_CUSTOMER_NAME);
      expect(member?.user.phone.startsWith(ANONYMIZED_PHONE_PREFIX)).toBe(true);

      // A identidade global órfã foi apagada.
      const oldUser = await admin.asPlatformAdmin((tx) =>
        tx.user.findUnique({ where: { id: userId } }),
      );
      expect(oldUser).toBeNull();

      // Auditoria registrada.
      const audit = await scoped.forTenant(fixture.tenantId, (tx) =>
        tx.auditLog.findFirst({
          where: { tenantId: fixture.tenantId, action: 'customer.erase' },
        }),
      );
      expect(audit).not.toBeNull();
    });

    it('exclusão num salão não afeta o vínculo noutro salão', async () => {
      const id = String(randomInt(0, 999_999)).padStart(6, '0');
      const phone = `+5548${id}`;

      const scenario = await admin.asPlatformAdmin(async (tx) => {
        const tenantA = await tx.tenant.create({
          data: { slug: `privacy-shared-a-${id}`, name: 'Salão A', document: '11111111111' },
        });
        const tenantB = await tx.tenant.create({
          data: { slug: `privacy-shared-b-${id}`, name: 'Salão B', document: '22222222222' },
        });
        const user = await tx.user.create({
          data: { phone, name: 'Cliente Compartilhado' },
        });
        const memberA = await tx.tenantMember.create({
          data: { tenantId: tenantA.id, userId: user.id, role: 'CUSTOMER' },
        });
        const memberB = await tx.tenantMember.create({
          data: { tenantId: tenantB.id, userId: user.id, role: 'CUSTOMER' },
        });
        return { tenantA, tenantB, user, memberA, memberB };
      });
      createdTenants.push(scenario.tenantA.id, scenario.tenantB.id);

      const result = await eraseCustomer({
        tenantId: scenario.tenantA.id,
        tenantMemberId: scenario.memberA.id,
        actorId: null,
      });

      expect(result).not.toBeNull();
      expect(result!.identityPurged).toBe(false);

      // O salão B continua enxergando a identidade real — o vínculo dele não foi tocado.
      const stillThere = await admin.asPlatformAdmin((tx) =>
        tx.user.findUnique({ where: { id: scenario.user.id } }),
      );
      expect(stillThere?.phone).toBe(phone);
      expect(stillThere?.name).toBe('Cliente Compartilhado');

      const memberB = await admin.asPlatformAdmin((tx) =>
        tx.tenantMember.findUnique({
          where: { id: scenario.memberB.id },
          select: { userId: true },
        }),
      );
      expect(memberB?.userId).toBe(scenario.user.id);

      // O salão A ficou anonimizado.
      const memberA = await admin.asPlatformAdmin((tx) =>
        tx.tenantMember.findUnique({
          where: { id: scenario.memberA.id },
          include: { user: true },
        }),
      );
      expect(memberA?.userId).not.toBe(scenario.user.id);
      expect(memberA?.user.name).toBe(ANONYMIZED_CUSTOMER_NAME);
    });
  });
});
