import { expect, test } from '@playwright/test';

/**
 * Portão do painel do estabelecimento (tronco F2.0).
 *
 * Sem sessão, qualquer rota sob `/painel` devolve o visitante à raiz — o login
 * é a F1.2, na raiz. O resto (menus por papel, isolamento) é coberto por
 * unidade e integração; aqui se prova que o portão vale no servidor de verdade.
 */

test('o painel exige sessão e devolve o visitante para a raiz', async ({ page }) => {
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('uma subrota do painel também passa pelo portão', async ({ page }) => {
  await page.goto('/painel/servicos');
  await expect(page).toHaveURL(/\/$/);
});
