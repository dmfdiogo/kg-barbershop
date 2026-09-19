import { expect, test } from '@playwright/test';

/**
 * Portal público no navegador (F3.0).
 *
 * Os dois primeiros testes usam `request` (HTML cru, sem executar JavaScript):
 * é a prova de que o tema sai do servidor e de que um portal não carrega dado
 * do outro. Os demais exercitam catálogo e responsividade a 360px.
 */

test('tema do tenant vai no HTML servido, verificável sem JavaScript', async ({ request }) => {
  const response = await request.get('/carlosbarber');
  expect(response.status()).toBe(200);

  const html = await response.text();
  expect(html).toContain('Barbearia do Carlos');
  // Espelha prisma/seed.mts (tenant carlosbarber, preset Classic Barber). A
  // primária é a cor de AÇÃO — âmbar —, não o tom escuro: primária quase preta
  // sobre fundo quase preto reprova na própria validação de contraste do painel.
  expect(html).toContain('--color-primary:#d97706');
  expect(html).toContain('--color-secondary:#b45309');
  expect(html).toContain('--color-background:#0c0a09');
  expect(html).toContain('color-scheme:dark');
});

test('tenant sem tema configurado renderiza com os padrões', async ({ request }) => {
  const response = await request.get('/petspaluna');
  expect(response.status()).toBe(200);

  const html = await response.text();
  expect(html).toContain('Pet Spa Luna');
  expect(html).toContain('--color-primary:#171717');
  expect(html).toContain('--color-background:#ffffff');
  expect(html).not.toContain('--color-primary:#1c1917');
});

test('catálogo de um portal não expõe serviço do outro tenant', async ({ request }) => {
  const html = await (await request.get('/petspaluna')).text();

  expect(html).toContain('Banho e tosa');
  expect(html).not.toContain('Corte masculino');
  expect(html).not.toContain('Coloração');
});

test('catálogo mostra serviço, duração e preço formatado', async ({ page }) => {
  await page.goto('/carlosbarber');

  await expect(page.getByRole('heading', { level: 1, name: 'Barbearia do Carlos' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Corte masculino' })).toBeVisible();
  await expect(page.getByText('R$ 50,00', { exact: true })).toBeVisible();
  await expect(page.getByText('30 min').first()).toBeVisible();

  await expect(page.getByRole('link', { name: 'Agendar Corte masculino' })).toHaveAttribute(
    'href',
    /^\/carlosbarber\/agendar\?servico=/,
  );
});

test('portal funciona a 360px, sem overflow horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/carlosbarber');

  await expect(page.getByRole('heading', { level: 1, name: 'Barbearia do Carlos' })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('slug inexistente mostra a página própria de estabelecimento não encontrado', async ({
  request,
}) => {
  const response = await request.get('/estabelecimento-que-nao-existe');

  expect(response.status()).toBe(404);
  expect(await response.text()).toContain('Estabelecimento não encontrado');
});
