import { expect, test } from '@playwright/test';

/**
 * Smoke e2e (tarefa F0.1): prova que o Playwright sobe a aplicação.
 * Os fluxos de produto entram a partir da fase 1.
 */
test('a aplicação responde', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
