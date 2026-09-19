import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { OUTBOX_FILE } from '../../playwright.config';

/**
 * Onboarding guiado (tarefa F2.5), o critério da spec §9.2: do zero ao link do
 * portal em MENOS DE 10 MINUTOS, cronometrado.
 *
 * Cada teste cria o próprio tenant (slug/telefone únicos) porque os projetos
 * mobile e desktop rodam em paralelo. O OTP é lido do espelho em arquivo que o
 * mock alimenta (`OUTBOX_FILE`), como no e2e do login (F1.2).
 *
 * O segundo teste é o "abandonar no meio e voltar": conclui só o primeiro passo,
 * sai do onboarding e volta — tem que retomar no passo seguinte, sem recomeçar.
 */

if (existsSync('.env')) process.loadEnvFile('.env');

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  }),
});

const TEN_MINUTES_MS = 10 * 60 * 1000;

interface OutboxLine {
  to?: string;
  kind?: string;
  code?: string;
}

interface Fixture {
  slug: string;
  tenantId: string;
  phone: { typed: string; e164: string };
}

function uniquePhone(): { typed: string; e164: string } {
  const random = String(randomInt(0, 100_000_000)).padStart(8, '0');
  const subscriber = `9${random}`;
  return {
    typed: `(48) ${subscriber.slice(0, 5)}-${subscriber.slice(5)}`,
    e164: `+5548${subscriber}`,
  };
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
          continue;
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

async function createOwnerFixture(): Promise<Fixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
  const slug = `e2e-onb-${suffix}`;
  const phone = uniquePhone();

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: `Studio E2E ${suffix}`,
      document: '00000000000',
      timezone: 'America/Sao_Paulo',
      status: 'ACTIVE',
    },
  });

  const owner = await prisma.user.create({ data: { phone: phone.e164, name: 'Dona E2E' } });
  await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: owner.id, role: 'OWNER' },
  });

  return { slug, tenantId: tenant.id, phone };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: fixture.tenantId } });
  await prisma.user.deleteMany({ where: { phone: fixture.phone.e164 } });
}

async function loginAsOwner(page: Page, fixture: Fixture): Promise<void> {
  await page.goto(`/${fixture.slug}/entrar`);
  await page.getByLabel('Nome').fill('Dona E2E');
  await page.getByLabel('WhatsApp').fill(fixture.phone.typed);
  await page.getByRole('button', { name: 'Receber código' }).click();
  await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/entrar/codigo`));

  const code = await latestOtpCode(fixture.phone.e164);
  await page.getByLabel('Código').fill(code);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Papel OWNER cai no painel, não no portal do cliente.
  await expect(page).toHaveURL(/\/painel$/);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ mode: 'serial' });

test('onboarding completo do zero ao link em menos de 10 minutos', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createOwnerFixture();
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginAsOwner(page, fixture);

    // O relógio começa aqui: é o instante em que o dono abre o onboarding.
    const startedAt = Date.now();
    await page.goto('/painel/onboarding');
    await expect(page).toHaveURL(/\/painel\/onboarding\/estabelecimento$/);

    // Passo 1 — dados do estabelecimento.
    await page.getByLabel('Nome do estabelecimento').fill('Studio Onboarding E2E');
    await page.getByLabel('CPF ou CNPJ').fill('12.345.678/0001-90');
    await page.getByLabel('Chave Pix').fill('pix@onboarding.test');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page).toHaveURL(/\/painel\/onboarding\/horario$/);

    // Passo 2 — expediente (o editor já vem com seg–sex preenchido).
    await page.getByRole('button', { name: 'Salvar jornada' }).click();
    await expect(page).toHaveURL(/\/painel\/onboarding\/servico$/);

    // Passo 3 — primeiro serviço (o formulário da F2.1, reusado).
    await page.getByLabel('Nome', { exact: true }).fill('Corte E2E');
    await page.getByLabel('Preço').fill('50,00');
    await page.getByRole('button', { name: 'Criar serviço' }).click();
    await expect(page).toHaveURL(/\/painel\/onboarding\/portal$/);

    // Passo 4 — link do portal.
    const portalSlug = `e2e-portal-${fixture.slug.slice(-6)}`;
    await page.getByLabel('Endereço do portal').fill(portalSlug);
    await page.getByRole('button', { name: 'Gerar link do portal' }).click();
    await expect(page).toHaveURL(/\/painel\/onboarding\/pronto$/);
    await expect(page.getByRole('heading', { name: 'Tudo pronto' })).toBeVisible();
    await expect(page.getByText(`/${portalSlug}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar link' })).toBeVisible();

    const elapsed = Date.now() - startedAt;
    expect(elapsed, `onboarding levou ${elapsed}ms`).toBeLessThan(TEN_MINUTES_MS);

    // O estado ficou persistido no banco, não só na tela.
    const progress = await prisma.onboardingProgress.findUniqueOrThrow({
      where: { tenantId: fixture.tenantId },
    });
    expect(progress.completedSteps).toHaveLength(4);
    expect(progress.pixKey).toBe('pix@onboarding.test');
    expect(progress.payoutStatus).toBe('AWAITING_ACTIVATION');

    const serviceCount = await prisma.service.count({ where: { tenantId: fixture.tenantId } });
    expect(serviceCount).toBe(1);
    const hoursCount = await prisma.workingHours.count({ where: { tenantId: fixture.tenantId } });
    expect(hoursCount).toBeGreaterThan(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await cleanup(fixture);
  }
});

test('abandonar no meio e voltar retoma exatamente onde parou', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await createOwnerFixture();
  try {
    await loginAsOwner(page, fixture);

    await page.goto('/painel/onboarding');
    await expect(page).toHaveURL(/\/painel\/onboarding\/estabelecimento$/);

    await page.getByLabel('Nome do estabelecimento').fill('Studio Retomada E2E');
    await page.getByLabel('CPF ou CNPJ').fill('123.456.789-01');
    await page.getByLabel('Chave Pix').fill('retomada@pix.test');
    await page.getByRole('button', { name: 'Salvar e continuar' }).click();
    await expect(page).toHaveURL(/\/painel\/onboarding\/horario$/);

    // Abandona sem salvar o expediente e vai fazer outra coisa.
    await page.goto('/painel/inicio');
    await expect(page.getByRole('heading', { name: 'Início' })).toBeVisible();

    // Volta ao onboarding: retoma no expediente, não no começo.
    await page.goto('/painel/onboarding');
    await expect(page).toHaveURL(/\/painel\/onboarding\/horario$/);
    await expect(page.getByRole('heading', { name: 'Horário de expediente' })).toBeVisible();

    // O que já foi salvo continua lá.
    await page.goto('/painel/onboarding/estabelecimento');
    await expect(page.getByLabel('Nome do estabelecimento')).toHaveValue('Studio Retomada E2E');
    await expect(page.getByLabel('Chave Pix')).toHaveValue('retomada@pix.test');
  } finally {
    await cleanup(fixture);
  }
});
