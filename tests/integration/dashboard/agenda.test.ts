import { randomInt } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionToken } from '@/lib/auth/session';
import { inviteStaff } from '@/lib/staffing/members';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import {
  agendaRange,
  createWalkIn,
  getOwnStaffId,
  loadAgendaBookings,
  markBookingCompleted,
  markBookingNoShow,
  resolveAgendaScope,
  todayInTimezone,
} from '@/app/(dashboard)/painel/agenda/_lib/agenda';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Agenda do painel (tarefa F3.5) contra Postgres real:
 *
 *   - walk-in NUNCA cria sobreposição (a exclusion constraint decide) e o erro
 *     vira mensagem de domínio, não 500;
 *   - finalizado e não compareceu persistem os carimbos;
 *   - o Staff só alcança a própria agenda — o colega devolvido pela URL vira
 *     `null`/404, nunca um 403 que confirme a existência;
 *   - isolamento entre tenants.
 */

const authState = vi.hoisted(() => ({ sessionCookie: null as string | null }));

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-tenant-host': 'localhost:3000' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'kg_session' && authState.sessionCookie
        ? { name, value: authState.sessionCookie }
        : undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => '/painel/agenda',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import AgendaPage from '@/app/(dashboard)/painel/agenda/page';

const FIXTURE_START = new Date('2026-11-03T13:00:00.000Z');
const TZ = 'America/Sao_Paulo';
const DATE = '2026-11-03';

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

describe('agenda do painel', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ownerUserIdA: string;
  let staffUserIdA: string;
  let secondStaffId: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'agenda-a');
    tenantB = await createTenantFixture(admin, 'agenda-b');

    const users = await admin.asPlatformAdmin(async (tx) => {
      const owner = await tx.tenantMember.findUnique({
        where: { id: tenantA.ownerMemberId },
        select: { userId: true },
      });
      const staff = await tx.tenantMember.findUnique({
        where: { id: tenantA.staffMemberId },
        select: { userId: true },
      });
      return { owner, staff };
    });
    ownerUserIdA = users.owner?.userId ?? '';
    staffUserIdA = users.staff?.userId ?? '';

    const invited = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Segundo Profissional', phone: randomPhone() }),
    );
    if (!invited.ok) throw new Error('não foi possível criar o segundo profissional');
    secondStaffId = invited.member.id;
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.tenantId);
      if (tenantB) await deleteTenant(admin, tenantB.tenantId);
      await scoped?.disconnect();
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  describe('escopo e permissão', () => {
    it('o Owner vê todos ou escolhe qualquer profissional do tenant', async () => {
      const all = await scoped.forTenant(tenantA.tenantId, (tx) =>
        resolveAgendaScope(tx, tenantA.tenantId, 'OWNER', tenantA.ownerMemberId, null),
      );
      expect(all).toMatchObject({ filterStaffId: null, ownStaffId: null });

      const one = await scoped.forTenant(tenantA.tenantId, (tx) =>
        resolveAgendaScope(tx, tenantA.tenantId, 'OWNER', tenantA.ownerMemberId, secondStaffId),
      );
      expect(one?.filterStaffId).toBe(secondStaffId);
    });

    it('o Staff só alcança a própria agenda, nem por URL', async () => {
      const own = await scoped.forTenant(tenantA.tenantId, (tx) =>
        resolveAgendaScope(tx, tenantA.tenantId, 'STAFF', tenantA.staffMemberId, null),
      );
      expect(own?.filterStaffId).toBe(tenantA.staffId);

      const byUrl = await scoped.forTenant(tenantA.tenantId, (tx) =>
        resolveAgendaScope(
          tx,
          tenantA.tenantId,
          'STAFF',
          tenantA.staffMemberId,
          secondStaffId,
        ),
      );
      expect(byUrl).toBeNull();

      const ownId = await scoped.forTenant(tenantA.tenantId, (tx) =>
        getOwnStaffId(tx, tenantA.tenantId, tenantA.staffMemberId),
      );
      expect(ownId).toBe(tenantA.staffId);
    });

    it('profissional de outro tenant vira null, nunca 403', async () => {
      const cross = await scoped.forTenant(tenantB.tenantId, (tx) =>
        resolveAgendaScope(tx, tenantB.tenantId, 'OWNER', tenantB.ownerMemberId, tenantA.staffId),
      );
      expect(cross).toBeNull();

      const missing = await scoped.forTenant(tenantA.tenantId, (tx) =>
        resolveAgendaScope(tx, tenantA.tenantId, 'OWNER', tenantA.ownerMemberId, 'nao-existe'),
      );
      expect(missing).toBeNull();
    });

    it('a página responde 404 quando o Staff pede o colega pela URL', async () => {
      authState.sessionCookie = createSessionToken({
        userId: staffUserIdA,
        activeTenantId: tenantA.tenantId,
      });

      await expect(
        AgendaPage({ searchParams: Promise.resolve({ staff: secondStaffId, view: 'day' }) }),
      ).rejects.toThrow('NEXT_NOT_FOUND');
    });

    it('a página aceita a própria agenda do Staff e o Owner filtrando o colega', async () => {
      authState.sessionCookie = createSessionToken({
        userId: staffUserIdA,
        activeTenantId: tenantA.tenantId,
      });
      const own = await AgendaPage({
        searchParams: Promise.resolve({ staff: tenantA.staffId, view: 'day' }),
      });
      expect(own).toBeTruthy();

      authState.sessionCookie = createSessionToken({
        userId: ownerUserIdA,
        activeTenantId: tenantA.tenantId,
      });
      const other = await AgendaPage({
        searchParams: Promise.resolve({ staff: secondStaffId, view: 'week' }),
      });
      expect(other).toBeTruthy();
    });
  });

  describe('walk-in e anti-overlap', () => {
    it('recusa walk-in sobre horário já ocupado, sem 500 e sem criar linha', async () => {
      const before = await admin.asPlatformAdmin((tx) =>
        tx.booking.count({
          where: { tenantId: tenantA.tenantId, staffId: tenantA.staffId, startsAt: FIXTURE_START },
        }),
      );

      const result = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Cliente Sobreposto',
        customerPhone: randomPhone(),
        startsAt: FIXTURE_START,
      });

      expect(result).toMatchObject({ ok: false, code: 'SLOT_UNAVAILABLE' });

      const after = await admin.asPlatformAdmin((tx) =>
        tx.booking.count({
          where: { tenantId: tenantA.tenantId, staffId: tenantA.staffId, startsAt: FIXTURE_START },
        }),
      );
      expect(after).toBe(before);
    });

    it('cria walk-in confirmado com source WALK_IN', async () => {
      const result = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Cliente Balcão',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T15:00:00.000Z'),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.booking.status).toBe('CONFIRMED');
      expect(result.booking.source).toBe('WALK_IN');
      expect(result.booking.displayStatus).toBe('CONFIRMED');
      expect(result.booking.customerName).toBe('Cliente Balcão');
      expect(result.booking.completedAt).toBeNull();
      expect(result.booking.noShowAt).toBeNull();
    });
  });

  describe('carimbos de finalizado e não compareceu', () => {
    it('marcar finalizado grava completedAt e o status COMPLETED', async () => {
      const created = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Vai Finalizar',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T16:00:00.000Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const stamp = new Date('2026-11-03T16:30:00.000Z');
      const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
        markBookingCompleted(tx, tenantA.tenantId, created.booking.id, { now: stamp }),
      );
      expect(result.ok).toBe(true);

      const row = await admin.asPlatformAdmin((tx) =>
        tx.booking.findUnique({
          where: { id: created.booking.id },
          select: { status: true, completedAt: true },
        }),
      );
      expect(row?.status).toBe('COMPLETED');
      expect(row?.completedAt?.toISOString()).toBe(stamp.toISOString());
    });

    it('marcar não compareceu grava noShowAt e o status NO_SHOW', async () => {
      const created = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Não Veio',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T17:00:00.000Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const stamp = new Date('2026-11-03T17:30:00.000Z');
      const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
        markBookingNoShow(tx, tenantA.tenantId, created.booking.id, { now: stamp }),
      );
      expect(result.ok).toBe(true);

      const row = await admin.asPlatformAdmin((tx) =>
        tx.booking.findUnique({
          where: { id: created.booking.id },
          select: { status: true, noShowAt: true },
        }),
      );
      expect(row?.status).toBe('NO_SHOW');
      expect(row?.noShowAt?.toISOString()).toBe(stamp.toISOString());
    });

    it('o Staff não carimba o atendimento de um colega', async () => {
      const created = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Do Colega',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T18:00:00.000Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
        markBookingCompleted(tx, tenantA.tenantId, created.booking.id, {
          allowedStaffId: secondStaffId,
        }),
      );
      expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });

      const row = await admin.asPlatformAdmin((tx) =>
        tx.booking.findUnique({
          where: { id: created.booking.id },
          select: { status: true },
        }),
      );
      expect(row?.status).toBe('CONFIRMED');
    });
  });

  describe('leitura e isolamento', () => {
    it('carrega o dia no fuso do tenant e não vaza entre tenants', async () => {
      // O dia local do tenant não coincide com o dia UTC — por isso o range
      // vem de `agendaRange`, nunca de uma meia-noite UTC.
      expect(todayInTimezone(TZ, FIXTURE_START)).toBe(DATE);
      const range = agendaRange('day', DATE, TZ);
      expect(range.start.toISOString()).toBe('2026-11-03T03:00:00.000Z');
      expect(range.end.toISOString()).toBe('2026-11-04T03:00:00.000Z');

      const doDia = await scoped.forTenant(tenantA.tenantId, (tx) =>
        loadAgendaBookings(tx, tenantA.tenantId, {
          staffId: tenantA.staffId,
          start: range.start,
          end: range.end,
        }),
      );
      expect(doDia.some((booking) => booking.id === tenantA.bookingId)).toBe(true);

      const deOutro = await scoped.forTenant(tenantB.tenantId, (tx) =>
        loadAgendaBookings(tx, tenantB.tenantId, { start: range.start, end: range.end }),
      );
      expect(deOutro.some((booking) => booking.id === tenantA.bookingId)).toBe(false);
    });

    it('walk-in de A não aparece na agenda de B', async () => {
      const created = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Exclusivo de A',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T19:00:00.000Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const range = agendaRange('day', DATE, TZ);
      const deOutro = await scoped.forTenant(tenantB.tenantId, (tx) =>
        loadAgendaBookings(tx, tenantB.tenantId, { start: range.start, end: range.end }),
      );
      expect(deOutro.some((booking) => booking.id === created.booking.id)).toBe(false);

      const cross = await scoped.forTenant(tenantB.tenantId, (tx) =>
        tx.booking.findUnique({ where: { id: created.booking.id }, select: { id: true } }),
      );
      expect(cross).toBeNull();
    });

    it('não lista hold vencido como ocupado', async () => {
      const created = await createWalkIn({
        tenantId: tenantA.tenantId,
        staffId: tenantA.staffId,
        serviceId: tenantA.serviceId,
        customerName: 'Hold Antigo',
        customerPhone: randomPhone(),
        startsAt: new Date('2026-11-03T20:00:00.000Z'),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Rebaixa para HOLD já vencido, como um soft lock abandonado.
      await admin.asPlatformAdmin((tx) =>
        tx.booking.update({
          where: { id: created.booking.id },
          data: {
            status: 'HOLD',
            holdSessionId: 'abandonado',
            holdExpiresAt: new Date('2026-11-03T19:59:00.000Z'),
          },
        }),
      );

      const range = agendaRange('day', DATE, TZ);
      const bookings = await scoped.forTenant(tenantA.tenantId, (tx) =>
        loadAgendaBookings(tx, tenantA.tenantId, {
          staffId: tenantA.staffId,
          start: range.start,
          end: range.end,
          now: new Date('2026-11-03T20:30:00.000Z'),
        }),
      );
      expect(bookings.some((booking) => booking.id === created.booking.id)).toBe(false);
    });
  });
});
