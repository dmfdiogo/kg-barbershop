import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTenantDb, type TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import {
  assessServiceDeletion,
  createService,
  deleteService,
  getService,
  listServices,
  setServiceActive,
  updateService,
} from '@/lib/catalog/services';
import { deletionRefusalMessage } from '@/lib/catalog/messages';
import { validateServiceForm } from '@/lib/catalog/validation';
import type { ValidatedService } from '@/lib/catalog/types';
import {
  createAdminDb,
  createTenantFixture,
  deleteTenant,
  ensureTestDatabase,
  rlsDatabaseUrl,
  type TenantFixture,
} from '../helpers/test-database';

/**
 * Catálogo de serviços (tarefa F2.1), com Postgres real e a role SEM superuser
 * (`kg_rls_app`), para que a RLS valha de fato:
 *
 *   - serviço com agendamento futuro não é excluído — a recusa vira oferta de
 *     desativar;
 *   - isolamento entre tenants: A não lê nem altera serviço de B;
 *   - o portão da tela barra o Staff e libera o dono.
 *
 * `now` é fixo e anterior à data do fixture, para o teste não depender do
 * relógio da máquina.
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
  usePathname: () => '/painel/servicos',
}));

import ServicosLayout from '@/app/(dashboard)/painel/servicos/layout';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function serviceInput(overrides: Record<string, unknown> = {}): ValidatedService {
  const result = validateServiceForm({
    name: 'Barba',
    durationMin: '20',
    bufferMin: '5',
    price: '35,00',
    paymentMode: 'DEPOSIT',
    depositMode: 'PERCENT',
    depositValue: '30',
    staffIds: [],
    active: true,
    ...overrides,
  });
  if (!result.ok) throw new Error(`input inválido no teste: ${JSON.stringify(result.fieldErrors)}`);
  return result.value;
}

describe('catálogo de serviços', () => {
  let admin: TenantDb;
  let scoped: TenantDb;
  let tenantA: TenantFixture;
  let tenantB: TenantFixture;
  let ownerUserIdA: string;
  let staffUserIdA: string;

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    scoped = createTenantDb(rlsDatabaseUrl());

    tenantA = await createTenantFixture(admin, 'catalogo-a');
    tenantB = await createTenantFixture(admin, 'catalogo-b');

    const owner = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantA.ownerMemberId },
        select: { userId: true },
      }),
    );
    const staff = await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.findUnique({
        where: { id: tenantA.staffMemberId },
        select: { userId: true },
      }),
    );
    ownerUserIdA = owner?.userId ?? '';
    staffUserIdA = staff?.userId ?? '';
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

  it('serviço com agendamento futuro NÃO é excluído: recusa e oferece desativar', async () => {
    const assessment = await scoped.forTenant(tenantA.tenantId, (tx) =>
      assessServiceDeletion(tx, tenantA.tenantId, tenantA.serviceId, NOW),
    );
    expect(assessment).toMatchObject({
      canDelete: false,
      code: 'HAS_FUTURE_BOOKINGS',
      futureBookings: 1,
    });

    const refusal = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deleteService(tx, tenantA.tenantId, tenantA.serviceId, NOW),
    );
    expect(refusal.ok).toBe(false);
    if (!refusal.ok && refusal.code === 'HAS_FUTURE_BOOKINGS') {
      expect(deletionRefusalMessage(refusal)).toMatch(/desativ/i);
    }

    const stillThere = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getService(tx, tenantA.tenantId, tenantA.serviceId),
    );
    expect(stillThere).not.toBeNull();
  });

  it('desativar tira do catálogo e preserva o serviço e o agendamento', async () => {
    const deactivated = await scoped.forTenant(tenantA.tenantId, (tx) =>
      setServiceActive(tx, tenantA.tenantId, tenantA.serviceId, false),
    );
    expect(deactivated).toBe(true);

    const service = await scoped.forTenant(tenantA.tenantId, (tx) =>
      getService(tx, tenantA.tenantId, tenantA.serviceId),
    );
    expect(service?.active).toBe(false);

    const refusal = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deleteService(tx, tenantA.tenantId, tenantA.serviceId, NOW),
    );
    expect(refusal.ok).toBe(false);
  });

  it('cria e exclui um serviço sem agendamentos', async () => {
    const created = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createService(tx, tenantA.tenantId, serviceInput({ name: 'Sobrancelha' })),
    );
    expect(created.priceCents).toBe(3500);
    expect(created.depositPercent).toBe(30);

    const deleted = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deleteService(tx, tenantA.tenantId, created.id, NOW),
    );
    expect(deleted).toEqual({ ok: true });
  });

  it('sincroniza os profissionais habilitados', async () => {
    const created = await scoped.forTenant(tenantA.tenantId, (tx) =>
      createService(tx, tenantA.tenantId, serviceInput({ staffIds: [tenantA.staffId] })),
    );
    expect(created.staffIds).toEqual([tenantA.staffId]);

    const updated = await scoped.forTenant(tenantA.tenantId, (tx) =>
      updateService(tx, tenantA.tenantId, created.id, serviceInput({ staffIds: [] })),
    );
    expect(updated?.staffIds).toEqual([]);
  });

  it('A não lê nem altera serviço de B (isolamento + RLS)', async () => {
    const mine = await scoped.forTenant(tenantA.tenantId, (tx) =>
      listServices(tx, tenantA.tenantId),
    );
    expect(mine.some((service) => service.id === tenantB.serviceId)).toBe(false);

    // Sem `tenantId` explícito, a RLS sozinha já filtra o outro tenant.
    const rlsOnly = await scoped.forTenant(tenantA.tenantId, (tx) =>
      tx.service.findMany({ select: { id: true } }),
    );
    expect(rlsOnly.some((row) => row.id === tenantB.serviceId)).toBe(false);

    const crossUpdate = await scoped.forTenant(tenantA.tenantId, (tx) =>
      updateService(tx, tenantA.tenantId, tenantB.serviceId, serviceInput({ name: 'Invadido' })),
    );
    expect(crossUpdate).toBeNull();

    const crossToggle = await scoped.forTenant(tenantA.tenantId, (tx) =>
      setServiceActive(tx, tenantA.tenantId, tenantB.serviceId, false),
    );
    expect(crossToggle).toBe(false);

    const crossDelete = await scoped.forTenant(tenantA.tenantId, (tx) =>
      deleteService(tx, tenantA.tenantId, tenantB.serviceId, NOW),
    );
    expect(crossDelete).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('o dono acessa a tela de serviços; o Staff recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    const html = renderToStaticMarkup(
      await ServicosLayout({ children: 'conteudo-de-servicos' }),
    );
    expect(html).toContain('conteudo-de-servicos');

    authState.sessionCookie = createSessionToken({
      userId: staffUserIdA,
      activeTenantId: tenantA.tenantId,
    });
    await expect(ServicosLayout({ children: 'x' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('sem sessão, a tela manda para a raiz', async () => {
    await expect(ServicosLayout({ children: 'x' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
