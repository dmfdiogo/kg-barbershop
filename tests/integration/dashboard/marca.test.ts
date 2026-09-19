import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import { resolveTheme, themeCssText } from '@/lib/theme/resolve';
import { PortalShell } from '@/components/portal/PortalShell';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * Tela de marca (F2.3) com banco real.
 *
 * Prova o que o aceite exige:
 *   - preset grava as TRÊS cores nas colunas do Tenant e o rótulo do preset;
 *   - a gravação é auditada;
 *   - isolamento: o tenant vem da sessão, nunca do formulário;
 *   - Staff não edita a marca (a action exige OWNER);
 *   - contraste ruim recusa sem confirmação;
 *   - logo: tipo pelo conteúdo e SVG com script recusado;
 *   - as cores da coluna chegam ao HTML do SSR (sem flash de tema).
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
  usePathname: () => '/painel/marca',
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

import { saveBrandingAction } from '@/app/(dashboard)/painel/marca/actions';
import PortalLayout from '@/app/[slug]/(portal)/layout';

interface TenantRef {
  id: string;
  slug: string;
  name: string;
}

const encoder = new TextEncoder();

function svgBytes(source: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(source);
}

const CLEAN_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function brandingForm(overrides: Partial<Record<string, string | Blob>> = {}): FormData {
  const form = new FormData();
  form.set('colorPrimary', '#0369a1');
  form.set('colorSecondary', '#0f766e');
  form.set('colorBackground', '#fefce8');
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    form.set(key, value);
  }
  return form;
}

describe('marca do estabelecimento', () => {
  let admin: TenantDb;
  let tenantA: TenantRef;
  let tenantB: TenantRef;
  let ownerA: { id: string };
  let ownerB: { id: string };
  let staffA: { id: string };

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();
    const id = String(randomInt(0, 999_999)).padStart(6, '0');

    tenantA = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: { slug: `marca-a-${id}`, name: `Barbearia Marca A ${id}`, document: '12345678901' },
        select: { id: true, slug: true, name: true },
      }),
    );
    tenantB = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: { slug: `marca-b-${id}`, name: `Pet Shop Marca B ${id}`, document: '98765432000155' },
        select: { id: true, slug: true, name: true },
      }),
    );

    const [ownerAUser, ownerBUser, staffAUser] = await admin.asPlatformAdmin((tx) =>
      Promise.all([
        tx.user.create({ data: { phone: `+5548${id}11`, name: 'Dono Marca A' } }),
        tx.user.create({ data: { phone: `+5548${id}12`, name: 'Dono Marca B' } }),
        tx.user.create({ data: { phone: `+5548${id}13`, name: 'Equipe Marca A' } }),
      ]),
    );

    await admin.asPlatformAdmin((tx) =>
      Promise.all([
        tx.tenantMember.create({ data: { tenantId: tenantA.id, userId: ownerAUser.id, role: 'OWNER' } }),
        tx.tenantMember.create({ data: { tenantId: tenantB.id, userId: ownerBUser.id, role: 'OWNER' } }),
        tx.tenantMember.create({ data: { tenantId: tenantA.id, userId: staffAUser.id, role: 'STAFF' } }),
      ]),
    );

    ownerA = ownerAUser;
    ownerB = ownerBUser;
    staffA = staffAUser;
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      if (tenantA) await deleteTenant(admin, tenantA.id);
      if (tenantB) await deleteTenant(admin, tenantB.id);
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  function asOwner(ref: TenantRef, user: { id: string }): void {
    authState.sessionCookie = createSessionToken({ userId: user.id, activeTenantId: ref.id });
  }

  function readTenant(ref: TenantRef) {
    return admin.asPlatformAdmin((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: ref.id },
        select: {
          colorPrimary: true,
          colorSecondary: true,
          colorBackground: true,
          themePreset: true,
          logoUrl: true,
        },
      }),
    );
  }

  it('aplica um preset gravando as três cores e o rótulo, e audita a mudança', async () => {
    asOwner(tenantA, ownerA);

    const result = await saveBrandingAction(brandingForm());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.presetId).toBe('pet-friendly');

    const row = await readTenant(tenantA);
    expect(row).toMatchObject({
      colorPrimary: '#0369a1',
      colorSecondary: '#0f766e',
      colorBackground: '#fefce8',
      themePreset: 'pet-friendly',
    });

    const audits = await admin.asPlatformAdmin((tx) =>
      tx.auditLog.findMany({
        where: { tenantId: tenantA.id, action: 'tenant.branding_update' },
        select: { actorId: true },
      }),
    );
    expect(audits.some((entry) => entry.actorId === ownerA.id)).toBe(true);
  });

  it('ignora um tenantId forjado no formulário — o tenant vem da sessão', async () => {
    asOwner(tenantA, ownerA);
    const beforeB = await readTenant(tenantB);

    // Paleta "Auto Detail": passa no contraste, então salva sem confirmação.
    const form = brandingForm({
      colorPrimary: '#3b82f6',
      colorSecondary: '#ef4444',
      colorBackground: '#18181b',
    });
    form.set('tenantId', tenantB.id);
    const result = await saveBrandingAction(form);

    expect(result.ok).toBe(true);
    const afterB = await readTenant(tenantB);
    expect(afterB).toEqual(beforeB);

    const afterA = await readTenant(tenantA);
    expect(afterA.colorPrimary).toBe('#3b82f6');
  });

  it('staff não edita a marca', async () => {
    asOwner(tenantA, staffA);
    const before = await readTenant(tenantA);

    const result = await saveBrandingAction(brandingForm());

    expect(result).toEqual({ ok: false, code: 'FORBIDDEN', message: expect.any(String) });
    expect(await readTenant(tenantA)).toEqual(before);
  });

  it('contraste ruim recusa sem confirmação e só salva com ela', async () => {
    asOwner(tenantB, ownerB);
    const before = await readTenant(tenantB);

    const bad = brandingForm({
      colorPrimary: '#ffff00',
      colorSecondary: '#ffff00',
      colorBackground: '#ffffff',
    });

    const refused = await saveBrandingAction(bad);
    expect(refused.ok).toBe(false);
    if (refused.ok || refused.code !== 'LOW_CONTRAST') throw new Error('esperava LOW_CONTRAST');
    expect(refused.issues.length).toBeGreaterThan(0);
    expect(await readTenant(tenantB)).toEqual(before);

    bad.set('confirmLowContrast', 'on');
    const confirmed = await saveBrandingAction(bad);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.issues.length).toBeGreaterThan(0);
    expect((await readTenant(tenantB)).colorPrimary).toBe('#ffff00');
  });

  it('recusa SVG com script e aceita PNG limpo (tipo pelo conteúdo)', async () => {
    asOwner(tenantB, ownerB);

    const malicious = new File(
      [svgBytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      'logo.svg',
      { type: 'image/svg+xml' },
    );
    const refused = await saveBrandingAction(brandingForm({ logo: malicious }));
    expect(refused).toEqual({ ok: false, code: 'INVALID_LOGO', message: expect.any(String) });
    expect((await readTenant(tenantB)).logoUrl).toBeNull();

    const clean = new File([CLEAN_PNG as unknown as BlobPart], 'logo.png', { type: 'image/png' });
    const accepted = await saveBrandingAction(brandingForm({ logo: clean }));
    expect(accepted.ok).toBe(true);
    expect((await readTenant(tenantB)).logoUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('as cores gravadas chegam ao HTML do SSR, sem flash', async () => {
    asOwner(tenantA, ownerA);
    await saveBrandingAction(brandingForm({ colorPrimary: '#0369a1', colorBackground: '#fefce8' }));

    const html = await PortalLayout({
      children: 'catálogo',
      params: Promise.resolve({ slug: tenantA.slug }),
    });
    const markup = renderToStaticMarkup(html);

    expect(markup).toContain('id="tenant-theme"');
    expect(markup).toContain('--color-primary:#0369a1');
    expect(markup).toContain('--color-background:#fefce8');
    expect(markup).toContain(tenantA.name);
    expect(markup).not.toContain(tenantB.name);
    // O <style> vem antes do conteúdo: o navegador pinta já com o tema certo.
    expect(markup.indexOf('tenant-theme')).toBeLessThan(markup.indexOf(tenantA.name));
  });

  it('o HTML do SSR acompanha a troca de preset, sem script de tema', async () => {
    const row = {
      name: 'Troca de Preset',
      logoUrl: null,
      colorPrimary: '#3b82f6',
      colorSecondary: '#ef4444',
      colorBackground: '#18181b',
    };
    const first = renderToStaticMarkup(
      PortalShell({ tenant: row, theme: resolveTheme(row), basePath: '', children: 'x' }),
    );
    expect(first).toContain('--color-background:#18181b');

    const changed = { ...row, colorPrimary: '#d4a24c', colorBackground: '#0c0a09' };
    const second = renderToStaticMarkup(
      PortalShell({ tenant: changed, theme: resolveTheme(changed), basePath: '', children: 'x' }),
    );
    expect(second).toContain('--color-background:#0c0a09');
    expect(second).not.toContain('#18181b');
    expect(themeCssText(resolveTheme(changed))).not.toContain('<script');
  });
});
