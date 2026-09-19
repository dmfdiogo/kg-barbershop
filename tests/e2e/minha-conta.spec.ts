import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { OUTBOX_FILE } from '../../playwright.config';

/**
 * Cancelamento pela área do cliente (F3.4).
 *
 * Fluxo real no navegador: agenda pelo portal (OTP), vai para `minha-conta`,
 * cancela dentro da janela e, no segundo cenário, fora da janela encontra a
 * política em vez do botão sumido. Cada teste cria o próprio tenant — os
 * projetos `mobile` e `desktop` rodam em paralelo e um slug compartilhado faria
 * os dois disputarem o mesmo slot.
 */

if (existsSync('.env')) process.loadEnvFile('.env');

const TZ = 'America/Sao_Paulo';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  }),
});

interface Fixture {
  slug: string;
  serviceName: string;
  cancellationWindowHours: number;
  phones: string[];
}

interface OutboxLine {
  to?: string;
  kind?: string;
  code?: string;
}

function wallClock(hours: number, minutes: number): Date {
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
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

async function createFixture(cancellationWindowHours: number): Promise<Fixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
  const slug = `e2e-conta-${suffix}`;

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: `Studio Conta ${suffix}`,
      document: '12345678901',
      timezone: TZ,
      status: 'ACTIVE',
      minAdvanceMinutes: 0,
      maxAdvanceMinutes: null,
      cancellationWindowHours,
    },
  });

  const staffPhone = uniquePhone().e164;
  const staffUser = await prisma.user.create({
    data: { phone: staffPhone, name: 'Profissional Conta' },
  });
  const staffMember = await prisma.tenantMember.create({
    data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' },
  });
  const profile = await prisma.staffProfile.create({
    data: { tenantId: tenant.id, tenantMemberId: staffMember.id },
  });

  // Aberto todos os dias, 08:00–20:00: o teste não depende do dia da semana.
  for (let weekday = 0; weekday < 7; weekday += 1) {
    await prisma.workingHours.create({
      data: {
        tenantId: tenant.id,
        staffId: profile.id,
        weekday,
        startTime: wallClock(8, 0),
        endTime: wallClock(20, 0),
      },
    });
  }

  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Corte Conta',
      durationMin: 30,
      bufferMin: 10,
      priceCents: 5000,
      paymentMode: 'ON_SITE',
    },
  });
  await prisma.staffService.create({
    data: { tenantId: tenant.id, staffId: profile.id, serviceId: service.id },
  });

  return { slug, serviceName: service.name, cancellationWindowHours, phones: [staffPhone] };
}

async function cleanup(fixture: Fixture, extraPhones: string[]): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: fixture.slug } });
  if (tenant) {
    await prisma.tenant.delete({ where: { id: tenant.id } });
  }
  const phones = [...fixture.phones, ...extraPhones];
  if (phones.length > 0) {
    await prisma.user.deleteMany({ where: { phone: { in: phones } } });
  }
}

/**
 * Agenda pelo portal e para na confirmação, já com sessão estabelecida.
 *
 * Usa o ÚLTIMO horário do dia de propósito: cancelar exige `startsAt >= now`, e
 * o fim do expediente dá margem de sobra para a janela zero.
 */
async function bookThroughPortal(page: Page, fixture: Fixture): Promise<string> {
  const phone = uniquePhone();
  fixture.phones.push(phone.e164);

  await page.goto(`/${fixture.slug}`);
  await page.getByRole('link', { name: `Agendar ${fixture.serviceName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/agendar\\?servico=`));

  await page.getByRole('button', { name: /Qualquer profissional/ }).click();

  // Amanhã, não hoje: a grade de hoje esvazia perto do fim do expediente, e o
  // teste não pode depender da hora em que roda. Os botões de dia são os únicos
  // com `aria-pressed`.
  const days = page.locator('button[aria-pressed]');
  await expect(days.first()).toBeVisible();
  await days.nth(1).click();

  const slot = page.locator('ul.grid button').last();
  await expect(slot).toBeVisible();
  await slot.click();

  await expect(
    page.getByRole('heading', { name: 'Confirme com o seu WhatsApp' }),
  ).toBeVisible();
  await page.getByLabel('Nome', { exact: true }).fill('Cliente Conta');
  await page.getByLabel('WhatsApp', { exact: true }).fill(phone.typed);
  await page.getByRole('button', { name: 'Receber código' }).click();

  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();
  const code = await latestOtpCode(phone.e164);
  await page.getByLabel('Código', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(page.getByText('Agendamento confirmado')).toBeVisible();

  return phone.e164;
}

async function statusOfLatestBooking(slug: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
  const booking = await prisma.booking.findFirst({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });
  return booking?.status ?? null;
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ mode: 'serial' });

test('cliente cancela dentro da janela e o agendamento vai para o histórico', async ({ page }) => {
  const fixture = await createFixture(0);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await bookThroughPortal(page, fixture);

    await page.goto(`/${fixture.slug}/minha-conta`);
    await expect(page.getByRole('heading', { name: 'Meus agendamentos' })).toBeVisible();
    await expect(page.getByText(fixture.serviceName).first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.getByText('Agendamento cancelado.')).toBeVisible();
    await expect(page.getByText('Cancelado', { exact: true })).toBeVisible();
    expect(await statusOfLatestBooking(fixture.slug)).toBe('CANCELLED');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await cleanup(fixture, []);
  }
});

test('fora da janela o botão explica a política e não cancela', async ({ page }) => {
  const fixture = await createFixture(100_000);
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    await bookThroughPortal(page, fixture);

    await page.goto(`/${fixture.slug}/minha-conta`);
    await expect(page.getByRole('heading', { name: 'Meus agendamentos' })).toBeVisible();

    // O botão continua visível: clicar nele revela a política, não um erro.
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByText(/prazo já passou/)).toBeVisible();

    expect(await statusOfLatestBooking(fixture.slug)).toBe('CONFIRMED');
  } finally {
    await cleanup(fixture, []);
  }
});
