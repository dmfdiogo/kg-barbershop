import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estrutural do portão do Super Admin.
 *
 * A F1.4 descobriu que `notFound()` lançado no layout do GRUPO `(platform)`
 * escapa para o 404 da raiz — o boundary fica por dentro do layout. Por isso o
 * portão vive no layout do SEGMENTO (`plataforma/layout.tsx`).
 *
 * A consequência é o risco que este teste existe para impedir: um segmento novo
 * irmão dentro de `(platform)` nasceria FORA do portão, público, e nada avisaria.
 * Documentação não protege contra isso; um teste protege.
 */
const PLATFORM_DIR = path.join(process.cwd(), 'app', '(platform)');

describe('portão do Super Admin cobre todo o grupo (platform)', () => {
  it('todo segmento de rota tem layout chamando requireSuperAdmin', () => {
    const segmentos = readdirSync(PLATFORM_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(segmentos.length).toBeGreaterThan(0);

    const desprotegidos = segmentos.filter((segmento) => {
      const layout = path.join(PLATFORM_DIR, segmento, 'layout.tsx');
      if (!existsSync(layout)) return true;
      return !readFileSync(layout, 'utf8').includes('requireSuperAdmin');
    });

    expect(
      desprotegidos,
      `Segmento(s) sem portão em app/(platform): ${desprotegidos.join(', ')}. ` +
        'Todo segmento do grupo precisa de layout.tsx chamando requireSuperAdmin — ' +
        'o layout do grupo NÃO serve, porque notFound() lançado nele escapa para o 404 da raiz.',
    ).toEqual([]);
  });
});
