import { randomInt } from 'node:crypto';
import { fromZonedTime } from 'date-fns-tz';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import {
  createTimeOff,
  deleteTimeOff,
  getStaffMember,
  inviteStaff,
  listStaffMembers,
  listTimeOff,
  replaceWeeklySchedule,
} from '@/lib/staffing/members';
import type { ValidatedWeekday } from '@/lib/staffing/types';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Equipe e jornadas (tarefa F2.2), com Postgres real e a role SEM superuser
 * (`kg_rls_app`), para que a RLS valha de fato:
 *
 *   - convite cria `TenantMember` STAFF e é idempotente;
 *   - reduzir jornada com agendamento no intervalo apresenta os conflitos e
 *     exige decisão explícita, sem apagar o agendamento;
 *   - bloqueio pontual segue a mesma regra;
 *   - isolamento entre tenants;
 *   - o portão da tela barra o Staff.
 *
 * `now` é fixo e anterior à data do fixture, para o teste não depender do
 * relógio da máquina. O fixture de agendamento cai em 2026-11-03 (terça) às
 * 10:00 no fuso America/Sao_Paulo, com 40 min de bloqueio (30 + buffer).
 */

const authState = vi.hoisted(() => ({
  sessionCookie: null as string | null,
}));

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
  usePathname: () => '/painel/equipe',
}));

import EquipeLayout from '@/app/(dashboard)/painel/equipe/layout';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const TZ = 'America/Sao_Paulo';
const WEEKDAY = 2; // 2026-11-03 é terça

const COVERING: ValidatedWeekday[] = [
  { weekday: WEEKDAY, ranges: [{ startMin: 9 * 60, endMin: 12 * 60 }] },
];
const REDUCED: ValidatedWeekday[] = [
  { weekday: WEEKDAY, ranges: [{ startMin: 11 * 60, endMin: 12 * 60 }] },
];

function randomPhone(): string {
  return `+5548${String(randomInt(0, 999_999_999)).padStart(9, '0')}`;
}

describe('equipe e jornadas', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ownerUserIdA: string;
  let staffUserIdA: string;
  let ownerPhoneA: string;
  let customerPhoneA: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'equipe-a');
    tenantB = await createTenantFixture(admin, 'equipe-b');

    const users = await admin.asPlatformAdmin(async (tx) => {
      const owner = await tx.tenantMember.findUnique({
        where: { id: tenantA.ownerMemberId },
        select: { userId: true, user: { select: { phone: true } } },
      });
      const staff = await tx.tenantMember.findUnique({
        where: { id: tenantA.staffMemberId },
        select: { userId: true },
      });
      const customer = await tx.tenantMember.findUnique({
        where: { id: tenantA.customerMemberId },
        select: { user: { select: { phone: true } } },
      });
      return { owner, staff, customer };
    });

    ownerUserIdA = users.owner?.userId ?? '';
    ownerPhoneA = users.owner?.user.phone ?? '';
    staffUserIdA = users.staff?.userId ?? '';
    customerPhoneA = users.customer?.user.phone ?? '';
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

  it('convite cria TenantMember STAFF com StaffProfile', async () => {
    const phone = randomPhone();
    const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Nova Pessoa', phone }),
    );
    expect(result.ok).toBe(true);

    const member = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findFirst({
        where: { tenantId: tenantA.tenantId, user: { phone } },
        select: { role: true, staffProfile: { select: { id: true } } },
      }),
    );
    expect(member?.role).toBe('STAFF');
    expect(member?.staffProfile?.id).toBeTruthy();
  });

  it('convidar de novo é idempotente e não duplica vínculo', async () => {
    const phone = randomPhone();
    const first = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Repetida', phone }),
    );
    const second = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Repetida', phone }),
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(second.member.id).toBe(first.member.id);

    const count = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.count({ where: { tenantId: tenantA.tenantId, user: { phone } } }),
    );
    expect(count).toBe(1);
  });

  it('promove a CUSTOMER a STAFF e preserva o único vínculo', async () => {
    const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Vira Staff', phone: customerPhoneA }),
    );
    expect(result.ok).toBe(true);

    const member = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantA.customerMemberId },
        select: { role: true },
      }),
    );
    expect(member?.role).toBe('STAFF');
  });

  it('recusa convidar quem já é dono', async () => {
    const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Dono', phone: ownerPhoneA }),
    );
    expect(result).toEqual(
      expect.objectContaining({ ok: false, code: 'ALREADY_OWNER' }),
    );
  });

  it('não vaza equipe entre tenants', async () => {
    const phone = randomPhone();
    const invited = await scoped.forTenant(tenantA.tenantId, (tx) =>
      inviteStaff(tx, tenantA.tenantId, { name: 'Isolada', phone }),
    );
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const seenByB = await scoped.forTenant(tenantB.tenantId, (tx) =>
      listStaffMembers(tx, tenantB.tenantId),
    );
    expect(seenByB.some((member) => member.id === invited.member.id)).toBe(false);

    const cross = await scoped.forTenant(tenantB.tenantId, (tx) =>
      getStaffMember(tx, tenantB.tenantId, invited.member.id),
    );
    expect(cross).toBeNull();

    const crossSchedule = await scoped.forTenant(tenantB.tenantId, (tx) =>
      replaceWeeklySchedule(tx, tenantB.tenantId, tenantA.staffId, COVERING, TZ, { now: NOW }),
    );
    expect(crossSchedule).toEqual(expect.objectContaining({ ok: false, code: 'NOT_FOUND' }));
  });

  it('reduzir jornada apresenta conflitos e exige decisão, sem apagar agendamento', async () => {
    // 1. Jornada que cobre o agendamento do fixture (10:00–10:40 local) salva limpa.
    const saved = await scoped.forTenant(tenantA.tenantId, (tx) =>
      replaceWeeklySchedule(tx, tenantA.tenantId, tenantA.staffId, COVERING, TZ, { now: NOW }),
    );
    expect(saved.ok).toBe(true);

    const afterSave = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getStaffMember(tx, tenantA.tenantId, tenantA.staffId),
    );
    expect(afterSave?.workingHours).toEqual([
      { weekday: WEEKDAY, startTime: '09:00', endTime: '12:00' },
    ]);

    // 2. Reduzir para 11:00–12:00 deixa o agendamento descoberto.
    const conflicted = await scoped.forTenant(tenantA.tenantId, (tx) =>
      replaceWeeklySchedule(tx, tenantA.tenantId, tenantA.staffId, REDUCED, TZ, { now: NOW }),
    );
    expect(conflicted.ok).toBe(false);
    if (!conflicted.ok) {
      expect(conflicted.code).toBe('CONFLICTS');
      expect(conflicted.conflicts?.map((conflict) => conflict.bookingId)).toContain(
        tenantA.bookingId,
      );
    }

    // 3. Nada foi gravado e o agendamento continua lá.
    const stillOld = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getStaffMember(tx, tenantA.tenantId, tenantA.staffId),
    );
    expect(stillOld?.workingHours).toEqual([
      { weekday: WEEKDAY, startTime: '09:00', endTime: '12:00' },
    ]);
    const booking = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: tenantA.bookingId }, select: { id: true } }),
    );
    expect(booking?.id).toBe(tenantA.bookingId);

    // 4. Com a decisão explícita, grava a nova jornada e o agendamento segue intacto.
    const confirmed = await scoped.forTenant(tenantA.tenantId, (tx) =>
      replaceWeeklySchedule(tx, tenantA.tenantId, tenantA.staffId, REDUCED, TZ, {
        now: NOW,
        confirmConflicts: true,
      }),
    );
    expect(confirmed.ok).toBe(true);
    const afterConfirm = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getStaffMember(tx, tenantA.tenantId, tenantA.staffId),
    );
    expect(afterConfirm?.workingHours).toEqual([
      { weekday: WEEKDAY, startTime: '11:00', endTime: '12:00' },
    ]);
    const bookingAfter = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: tenantA.bookingId }, select: { id: true } }),
    );
    expect(bookingAfter?.id).toBe(tenantA.bookingId);
  });

  it('bloqueio pontual sobre agendamento exige decisão e não apaga o agendamento', async () => {
    const startsAt = fromZonedTime('2026-11-03T09:30:00', TZ);
    const endsAt = fromZonedTime('2026-11-03T11:00:00', TZ);
    const input = { startsAt, endsAt, reason: 'Emergência' };

    const conflicted = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createTimeOff(tx, tenantA.tenantId, tenantA.staffId, input, { now: NOW }),
    );
    expect(conflicted.ok).toBe(false);
    if (!conflicted.ok) {
      expect(conflicted.code).toBe('CONFLICTS');
      expect(conflicted.conflicts?.some((conflict) => conflict.bookingId === tenantA.bookingId)).toBe(
        true,
      );
    }

    const confirmed = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createTimeOff(tx, tenantA.tenantId, tenantA.staffId, input, {
        now: NOW,
        confirmConflicts: true,
      }),
    );
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;

    const booking = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.booking.findUnique({ where: { id: tenantA.bookingId }, select: { id: true } }),
    );
    expect(booking?.id).toBe(tenantA.bookingId);

    const listed = await scoped.forTenant(tenantA.tenantId, (tx) =>
      listTimeOff(tx, tenantA.tenantId, tenantA.staffId),
    );
    expect(listed.some((timeOff) => timeOff.id === confirmed.timeOff.id)).toBe(true);

    const removed = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deleteTimeOff(tx, tenantA.tenantId, tenantA.staffId, confirmed.timeOff.id),
    );
    expect(removed).toBe(true);
  });

  it('bloqueio que não cruza agendamento entra sem conflito', async () => {
    const input = {
      startsAt: fromZonedTime('2026-11-03T14:00:00', TZ),
      endsAt: fromZonedTime('2026-11-03T15:00:00', TZ),
      reason: 'Almoço fora do comum',
    };
    const result = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createTimeOff(tx, tenantA.tenantId, tenantA.staffId, input, { now: NOW }),
    );
    expect(result.ok).toBe(true);
  });

  it('o dono acessa a tela de equipe; o Staff recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    const html = renderToStaticMarkup(await EquipeLayout({ children: 'conteudo-de-equipe' }));
    expect(html).toContain('conteudo-de-equipe');

    authState.sessionCookie = createSessionToken({
      userId: staffUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    await expect(EquipeLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a tela manda para a raiz', async () => {
    await expect(EquipeLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
