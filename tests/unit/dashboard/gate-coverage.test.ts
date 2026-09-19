import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guarda estrutural do portão do painel do estabelecimento (tronco F2.0).
 *
 * Mesma armadilha que a F1.4 documentou do lado da plataforma: `notFound()`
 * lançado no layout de um GRUPO escapa para o 404 da raiz, porque o boundary
 * fica por dentro do layout. Por isso o portão vive no layout do SEGMENTO
 * `painel/`. O risco é um segmento irmão nascer dentro de `(dashboard)` fora do
 * portão e ficar público — documentação não impede, um teste impede.
 */
const DASHBOARD_DIR = path.join(process.cwd(), 'app', '(dashboard)');
const PAINEL_LAYOUT = path.join(DASHBOARD_DIR, 'painel', 'layout.tsx');

describe('portão do painel cobre todo o grupo (dashboard)', () => {
  it('o layout do segmento painel exige papel, lança a negação e monta o shell', () => {
    expect(existsSync(PAINEL_LAYOUT)).toBe(true);
    const source = readFileSync(PAINEL_LAYOUT, 'utf8');

    expect(source).toContain('requireRole');
    // Lançar, nunca renderizar a negação com children montado atrás.
    expect(source).toContain('notFound');
    expect(source).toContain('redirect');
    expect(source).toContain('getDashboardNav');
  });

  it('nenhum segmento irmão de painel nasce fora do portão', () => {
    const segmentos = readdirSync(DASHBOARD_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(segmentos).toEqual(['painel']);
  });
});
