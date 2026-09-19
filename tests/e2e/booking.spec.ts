import { randomInt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { OUTBOX_FILE } from '../../playwright.config';

/**
 * Fluxo de agendamento no navegador (F3.3).
 *
 * Cada teste cria o próprio tenant (slug/telefone únicos), porque os projetos
 * `mobile` e `desktop` rodam em paralelo e um slug compartilhado faria os dois
 * disputarem o mesmo slot. O OTP é lido do espelho em arquivo que o mock
 * alimenta (`OUTBOX_FILE`), como no e2e do login da F1.2 — o `/dev/outbox`
 * responde 404 em produção, que é onde o Playwright sobe a aplicação.
 *
 * O banco é acessado pelo dono (superuser) para montar o cenário e conferir o
 * resultado; a aplicação em si continua exercitando a RLS normalmente.
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
  /** Telefones criados pelo teste, apagados no cleanup. */
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

async function createFixture(): Promise<Fixture> {
  const suffix = randomInt(0, 999_999).toString().padStart(6, '0');
  const slug = `e2e-book-${suffix}`;

  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: `Studio E2E ${suffix}`,
      document: '12345678901',
      timezone: TZ,
      status: 'ACTIVE',
      minAdvanceMinutes: 0,
      maxAdvanceMinutes: null,
    },
  });

  const staffPhone = uniquePhone().e164;
  const staffUser = await prisma.user.create({
    data: { phone: staffPhone, name: 'Profissional E2E' },
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
      name: 'Corte E2E',
      durationMin: 30,
      bufferMin: 10,
      priceCents: 5000,
      paymentMode: 'ON_SITE',
    },
  });
  await prisma.staffService.create({
    data: { tenantId: tenant.id, staffId: profile.id, serviceId: service.id },
  });

  return { slug, serviceName: service.name, phones: [staffPhone] };
}

/**
 * Apaga o tenant PRIMEIRO (cascata em booking/staff/service) e só então os
 * `user`. A ordem importa: `booking.staff_id` não tem cascata, então remover o
 * usuário do profissional antes do agendamento violaria a FK.
 */
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

/** Leva do catálogo até a tela do código OTP, devolvendo o telefone usado. */
async function reachOtpScreen(
  page: Page,
  fixture: Fixture,
): Promise<{ phone: { typed: string; e164: string } }> {
  const phone = uniquePhone();

  await page.goto(`/${fixture.slug}`);
  await page.getByRole('link', { name: `Agendar ${fixture.serviceName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/${fixture.slug}/agendar\\?servico=`));

  await page.getByRole('button', { name: /Qualquer profissional/ }).click();
  const slot = page.locator('ul.grid button').first();
  await expect(slot).toBeVisible();
  await slot.click();

  await expect(
    page.getByRole('heading', { name: 'Confirme com o seu WhatsApp' }),
  ).toBeVisible();
  await page.getByLabel('Nome', { exact: true }).fill('Cliente E2E');
  await page.getByLabel('WhatsApp', { exact: true }).fill(phone.typed);
  await page.getByRole('button', { name: 'Receber código' }).click();

  await expect(page.getByRole('heading', { name: 'Digite o código' })).toBeVisible();
  return { phone };
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe.configure({ mode: 'serial' });

test('agendamento completo a 360px, com OTP lido do outbox', async ({ page }) => {
  const fixture = await createFixture();
  const phones: string[] = [];
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    const { phone } = await reachOtpScreen(page, fixture);
    phones.push(phone.e164);

    const code = await latestOtpCode(phone.e164);
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Confirmar agendamento' }).click();

    await expect(page.getByText('Agendamento confirmado')).toBeVisible();

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: fixture.slug } });
    const booking = await prisma.booking.findFirstOrThrow({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, source: true },
    });
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.source).toBe('PORTAL');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await cleanup(fixture, phones);
  }
});

test('hold expira no meio do fluxo e o cliente retoma sem perder o que digitou', async ({
  page,
}) => {
  const fixture = await createFixture();
  const phones: string[] = [];
  try {
    await page.setViewportSize({ width: 360, height: 800 });
    const { phone } = await reachOtpScreen(page, fixture);
    phones.push(phone.e164);

    // Simula o que a criação do próximo hold faz: recolhe o vencido na mesma
    // transação. Com a linha fora, o horário pode ter ido para outra pessoa.
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: fixture.slug } });
    const removed = await prisma.booking.deleteMany({
      where: { tenantId: tenant.id, status: 'HOLD' },
    });
    expect(removed.count).toBe(1);

    const code = await latestOtpCode(phone.e164);
    await page.getByLabel('Código', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Confirmar agendamento' }).click();

    await expect(page.getByText('Seu horário foi liberado')).toBeVisible();

    // Recuperação limpa: volta à grade (o horário vencido volta a aparecer) e
    // conclui. Como o OTP já foi verificado, a confirmação é direta.
    await page.getByRole('button', { name: 'Escolher outro horário' }).click();
    const slot = page.locator('ul.grid button').first();
    await expect(slot).toBeVisible();
    await slot.click();

    await page.getByRole('button', { name: 'Confirmar agendamento' }).click();
    await expect(page.getByText('Agendamento confirmado')).toBeVisible();
  } finally {
    await cleanup(fixture, phones);
  }
});
