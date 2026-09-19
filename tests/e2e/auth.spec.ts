import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { OUTBOX_FILE } from '../../playwright.config';

/**
 * Login por OTP no navegador (F1.2, critério principal da tarefa).
 *
 * O Playwright sobe a aplicação em produção (`next start`), onde `/dev/outbox`
 * responde 404 de propósito. O código é lido do espelho em arquivo que o mock
 * alimenta via `MESSAGING_OUTBOX_FILE` — o mesmo caminho que o
 * `playwright.config.ts` passa ao servidor e exporta como `OUTBOX_FILE`.
 *
 * Cada teste usa um telefone único (nove dígitos aleatórios) e lê a última
 * mensagem ENDEREÇADA a ele. É isso que torna a leitura determinística sem
 * truncar um arquivo compartilhado entre projetos e workers em paralelo.
 */

const TENANT = 'carlosbarber';

interface OutboxLine {
  to?: string;
  kind?: string;
  code?: string;
}

async function latestOtpCode(phone: string): Promise<string> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const lines = readFileSync(OUTBOX_FILE, 'utf8').split('\n').filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        let message: OutboxLine;
        try {
          message = JSON.parse(lines[index]!) as OutboxLine;
        } catch {
          continue; // linha parcial enquanto o append acontece
        }
        if (message.to === phone && message.kind === 'otp' && message.code) {
          return message.code;
        }
      }
    } catch {
      // O arquivo só existe depois do primeiro envio.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Nenhum código OTP no outbox para ${phone}`);
}

function uniquePhone(): { typed: string; e164: string } {
  const random = String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0');
  const subscriber = `9${random}`; // celular brasileiro: 9 dígitos começando em 9
  return {
    typed: `(48) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`,
    e164: `+5548${subscriber}`,
  };
}

async function requestCode(page: Page, typedPhone: string): Promise<void> {
  await page.goto(`/${TENANT}/entrar`);
  await page.getByLabel('Nome').fill('Cliente E2E');
  await page.getByLabel('WhatsApp').fill(typedPhone);
  await page.getByRole('button', { name: 'Receber código' }).click();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/entrar/codigo`));
}

test.describe.configure({ mode: 'serial' });

test('login completo a 360px, lendo o código do outbox do mock', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const phone = uniquePhone();

  await requestCode(page, phone.typed);
  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();

  const code = await latestOtpCode(phone.e164);
  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(new RegExp(`/${TENANT}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Barbearia do Carlos' }),
  ).toBeVisible();

  // O cookie de sessão é `secure` mesmo em dev; o navegador o aceita em loopback.
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'kg_session');
  expect(session, 'sessão não foi estabelecida').toBeTruthy();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('código errado mostra tentativas restantes e o código certo entra', async ({ page }) => {
  const phone = uniquePhone();

  await requestCode(page, phone.typed);
  const code = await latestOtpCode(phone.e164);
  const wrongCode = code === '000000' ? '000001' : '000000';

  await page.getByLabel('Código').fill(wrongCode);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // O seletor é o id do aviso de erro: o Next injeta um `role="alert"` próprio
  // (route announcer) e `getByRole('alert')` ficaria ambíguo.
  const alert = page.locator('#auth-code-error');
  await expect(alert).toContainText('Código incorreto');
  await expect(alert).toContainText('Restam 4 tentativas');

  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(new RegExp(`/${TENANT}$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Barbearia do Carlos' }),
  ).toBeVisible();
});
