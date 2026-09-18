import { randomInt } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@/lib/tenant/db';
import { createSessionToken } from '@/lib/auth/session';
import { createAdminDb, deleteTenant, ensureTestDatabase } from '../helpers/test-database';

/**
 * Portão do painel da plataforma (F1.4):
 * `app/(platform)/plataforma/layout.tsx`, com o 404 em
 * `app/(platform)/not-found.tsx`.
 *
 * O layout é a única barreira entre um membro comum e as rotas do painel — as
 * telas da F7.3 nascem atrás dele. Aqui se prova que:
 *
 *   - sem sessão, vai para a raiz (não fica pedindo login em área nenhuma);
 *   - com sessão sem `isSuperAdmin`, `notFound()` é chamado (404 do segmento)
 *     e o conteúdo protegido não é renderizado;
 *   - com Super Admin, o conteúdo renderiza;
 *   - o 404 do segmento tem mensagem de plataforma, não de estabelecimento.
 *
 * `next/navigation` é mockado porque `notFound()`/`redirect()` fora do runtime
 * do Next lançam um erro sentinela — é exatamente o que queremos observar.
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
}));

import PlatformNotFound from '@/app/(platform)/not-found';
import PlatformLayout from '@/app/(platform)/plataforma/layout';

describe('portão do painel da plataforma', () => {
  let admin: TenantDb;
  let tenant: { id: string; slug: string };
  let ownerUser: { id: string };
  let superUser: { id: string };

  beforeAll(async () => {
    await ensureTestDatabase();
    admin = createAdminDb();

    const id = String(randomInt(0, 999_999)).padStart(6, '0');
    tenant = await admin.asPlatformAdmin((tx) =>
      tx.tenant.create({
        data: { slug: `gate-${id}`, name: `Gate ${id}`, document: '12345678901' },
        select: { id: true, slug: true },
      }),
    );
    ownerUser = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: `+5548${id}1`, name: 'Owner Comum' },
        select: { id: true },
      }),
    );
    superUser = await admin.asPlatformAdmin((tx) =>
      tx.user.create({
        data: { phone: `+5548${id}2`, name: 'Super Admin', isSuperAdmin: true },
        select: { id: true },
      }),
    );
    await admin.asPlatformAdmin((tx) =>
      tx.tenantMember.create({
        data: { tenantId: tenant.id, userId: ownerUser.id, role: 'OWNER' },
      }),
    );
  }, 180_000);

  afterAll(async () => {
    if (admin) {
      // deleteTenant leva junto o owner (não tem outro membership); o super
      // user é global e só some se apagado aqui.
      if (tenant) await deleteTenant(admin, tenant.id);
      if (superUser) {
        await admin.asPlatformAdmin((tx) => tx.user.delete({ where: { id: superUser.id } }));
      }
      await admin.disconnect();
    }
  });

  beforeEach(() => {
    authState.sessionCookie = null;
  });

  it('sem sessão manda para a raiz em vez de renderizar a área', async () => {
    await expect(PlatformLayout({ children: 'painel' })).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('Owner comum não vê o painel: recebe o 404 do segmento', async () => {
    authState.sessionCookie = createSessionToken({
      userId: ownerUser.id,
      activeTenantId: tenant.id,
    });

    await expect(PlatformLayout({ children: 'painel' })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('o 404 do segmento fala de plataforma, não de estabelecimento', () => {
    const html = renderToStaticMarkup(PlatformNotFound());

    expect(html).toContain('Página não encontrada');
    expect(html).not.toContain('Estabelecimento');
  });

  it('Super Admin renderiza o conteúdo da rota', async () => {
    authState.sessionCookie = createSessionToken({ userId: superUser.id });

    const element = await PlatformLayout({ children: 'conteúdo restrito' });
    expect(renderToStaticMarkup(element)).toContain('conteúdo restrito');
  });

  it('sessão apontando para usuário inexistente é sessão inválida, não acesso', async () => {
    authState.sessionCookie = createSessionToken({ userId: 'cuid-que-nao-existe' });

    await expect(PlatformLayout({ children: 'painel' })).rejects.toThrow('NEXT_REDIRECT:/');
  });
});
