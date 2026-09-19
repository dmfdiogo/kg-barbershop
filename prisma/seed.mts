/**
 * Seed de desenvolvimento (tarefa F0.5).
 *
 * Dois tenants, de propósito:
 *
 *   - "Barbearia do Carlos" (`carlosbarber`), completo. É contra ele que as
 *     fases 2 a 7 desenvolvem sem precisar cadastrar nada na mão.
 *   - "Pet Spa Luna" (`petspaluna`), mínimo mas funcional. Existe para que
 *     QUALQUER fase consiga escrever um teste de isolamento sem montar dado —
 *     a diretriz §9.3 da spec (dados de um salão nunca visíveis para outro) é
 *     a que mais precisa de prova, e prova exige dois tenants.
 *
 * Idempotente: apaga os dois tenants pelos ids fixos (cascata) e os usuários de
 * seed pelo prefixo de telefone, depois recria. Rodar duas vezes seguidas dá o
 * mesmo banco.
 *
 * Escreve por `asPlatformAdmin()`: a RLS está com FORCE, então nem o dono das
 * tabelas escreve em dois tenants sem passar pelo caminho auditado.
 */
import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';

// O seed roda pelo `node` puro, sem bundler, então NÃO importa de `lib/`: os
// módulos de lá usam imports sem extensão, que o ESM nativo não resolve.
// A duplicação aqui é de duas linhas (`set_config`) e compra um seed que roda
// em máquina limpa sem runner de TypeScript instalado.
type TenantTransaction = Prisma.TransactionClient;

if (!process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL não definida. Copie .env.example para .env (veja o CLAUDE.md).');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const TZ = 'America/Sao_Paulo';

/** Ids fixos: o seed é idempotente e os testes podem referenciá-los. */
export const SEED = {
  tenantA: 'seed-tenant-carlosbarber',
  tenantB: 'seed-tenant-petspaluna',
  phonePrefix: '+55489000',
} as const;

/** Hora de parede para colunas `@db.Time` — a data é ignorada pelo Postgres. */
function wallClock(hhmm: string): Date {
  return new Date(`1970-01-01T${hhmm}:00Z`);
}

/** Instante real a partir de data e hora locais do tenant. */
function instant(date: string, hhmm: string): Date {
  return fromZonedTime(`${date}T${hhmm}:00`, TZ);
}

/** Data local (YYYY-MM-DD) deslocada em dias a partir de hoje, no fuso do tenant. */
function localDate(offsetDays: number): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
}

function phone(n: number): string {
  return `${SEED.phonePrefix}${String(n).padStart(4, '0')}`;
}

async function wipe(tx: TenantTransaction): Promise<void> {
  // Tenant cascateia tudo que tem tenantId. User é global: some pelo prefixo.
  await tx.tenant.deleteMany({ where: { id: { in: [SEED.tenantA, SEED.tenantB] } } });
  await tx.user.deleteMany({ where: { phone: { startsWith: SEED.phonePrefix } } });
}

async function seedTenantA(tx: TenantTransaction): Promise<void> {
  const tenant = await tx.tenant.create({
    data: {
      id: SEED.tenantA,
      slug: 'carlosbarber',
      // Domínio próprio: existe no seed para que a resolução por Host tenha
      // dado real (F1.0). O provisionamento de DNS/SSL é fase 2 do produto.
      customDomain: 'www.carlosbarber.com.br',
      name: 'Barbearia do Carlos',
      document: '12345678000190',
      timezone: TZ,
      // Classic Barber: a primária é a cor de AÇÃO (âmbar), não o tom escuro.
      // Com primária quase preta sobre fundo quase preto, a tela de marca
      // dispara o aviso de contraste logo ao abrir — e o seed é o que todo
      // agente e toda demonstração enxergam primeiro.
      colorPrimary: '#d97706',
      colorSecondary: '#b45309',
      colorBackground: '#0c0a09',
      themePreset: 'classic-barber',
      cancellationWindowHours: 24,
      status: 'ACTIVE',
      trialBookingsUsed: 10,
      minAdvanceMinutes: 60,
      maxAdvanceMinutes: 60 * 24 * 60,
      noShowPolicyText: 'Faltas sem aviso podem reter o sinal pago.',
      membershipRequiresDeposit: false,
    },
  });

  const owner = await tx.user.create({
    data: { phone: phone(1), name: 'Carlos Menezes', email: 'carlos@exemplo.com.br' },
  });
  await tx.tenantMember.create({
    data: { tenantId: tenant.id, userId: owner.id, role: 'OWNER' },
  });

  // Três profissionais com jornadas propositalmente diferentes.
  const staffSpecs = [
    {
      name: 'Rafael Dias',
      bio: 'Corte clássico e navalha.',
      // Seg–Sex 09:00–18:00, sem intervalo.
      hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
    },
    {
      name: 'Bruna Alencar',
      bio: 'Barba e acabamento.',
      // Ter–Sáb, com ALMOÇO das 12:00 às 13:00 — modelado como duas faixas no
      // mesmo dia, não como bloqueio: intervalo recorrente é ausência de
      // jornada, não uma exceção pontual.
      hours: [2, 3, 4, 5, 6].flatMap((weekday) => [
        { weekday, start: '10:00', end: '12:00' },
        { weekday, start: '13:00', end: '19:00' },
      ]),
    },
    {
      name: 'Tiago Moraes',
      bio: 'Degradê e coloração.',
      // FOLGA NA SEGUNDA: simplesmente não tem jornada no weekday 1.
      hours: [3, 4, 5, 6].map((weekday) => ({ weekday, start: '11:00', end: '20:00' })),
    },
  ];

  const staff = [];
  for (const spec of staffSpecs) {
    const user = await tx.user.create({
      data: { phone: phone(10 + staff.length), name: spec.name },
    });
    const member = await tx.tenantMember.create({
      data: { tenantId: tenant.id, userId: user.id, role: 'STAFF' },
    });
    const profile = await tx.staffProfile.create({
      data: { tenantId: tenant.id, tenantMemberId: member.id, bio: spec.bio },
    });
    await tx.workingHours.createMany({
      data: spec.hours.map((h) => ({
        tenantId: tenant.id,
        staffId: profile.id,
        weekday: h.weekday,
        startTime: wallClock(h.start),
        endTime: wallClock(h.end),
      })),
    });
    staff.push(profile);
  }

  // Folga pontual do Rafael daqui a 3 dias, o dia inteiro.
  await tx.timeOff.create({
    data: {
      tenantId: tenant.id,
      staffId: staff[0]!.id,
      startsAt: instant(localDate(3), '00:00'),
      endsAt: instant(localDate(4), '00:00'),
      reason: 'Consulta médica',
    },
  });

  // Cinco serviços cobrindo as três modalidades de cobrança e buffers distintos.
  const serviceSpecs = [
    { name: 'Corte masculino', durationMin: 30, bufferMin: 10, priceCents: 5000, paymentMode: 'ON_SITE' as const },
    { name: 'Barba completa', durationMin: 20, bufferMin: 5, priceCents: 3500, paymentMode: 'ON_SITE' as const },
    { name: 'Corte + barba', durationMin: 50, bufferMin: 10, priceCents: 8000, paymentMode: 'DEPOSIT' as const, depositPercent: 30 },
    { name: 'Coloração', durationMin: 90, bufferMin: 15, priceCents: 18000, paymentMode: 'DEPOSIT' as const, depositCents: 5000 },
    { name: 'Pezinho', durationMin: 15, bufferMin: 0, priceCents: 2000, paymentMode: 'FULL_PREPAID' as const },
  ];

  const services = [];
  for (const spec of serviceSpecs) {
    services.push(await tx.service.create({ data: { tenantId: tenant.id, ...spec } }));
  }

  // Todo profissional faz tudo, menos coloração (só o Tiago).
  for (const profile of staff) {
    for (const service of services) {
      if (service.name === 'Coloração' && profile.id !== staff[2]!.id) continue;
      await tx.staffService.create({
        data: { tenantId: tenant.id, staffId: profile.id, serviceId: service.id },
      });
    }
  }

  // Vinte clientes.
  const customers = [];
  const nomes = [
    'Ana Souza', 'Bruno Lima', 'Carla Nunes', 'Diego Rocha', 'Elisa Prado',
    'Felipe Castro', 'Gabi Martins', 'Henrique Alves', 'Isabela Reis', 'João Pedro',
    'Karina Melo', 'Lucas Ferraz', 'Marina Costa', 'Nicolas Barros', 'Olívia Pinto',
    'Paulo Rangel', 'Queila Santos', 'Rodrigo Vieira', 'Sofia Camargo', 'Thiago Bastos',
  ];
  for (const [i, name] of nomes.entries()) {
    const user = await tx.user.create({ data: { phone: phone(100 + i), name } });
    customers.push(
      await tx.tenantMember.create({
        data: { tenantId: tenant.id, userId: user.id, role: 'CUSTOMER' },
      }),
    );
  }

  // Um cliente com opt-out de WhatsApp e outro com consentimento registrado —
  // a F6.2 precisa dos dois casos para testar preferências.
  await tx.messagingPref.create({
    data: {
      tenantId: tenant.id,
      userId: (await tx.tenantMember.findUniqueOrThrow({ where: { id: customers[0]!.id } })).userId,
      channel: 'WHATSAPP',
      consentAt: new Date(),
      consentSource: 'portal',
    },
  });
  await tx.messagingPref.create({
    data: {
      tenantId: tenant.id,
      userId: (await tx.tenantMember.findUniqueOrThrow({ where: { id: customers[1]!.id } })).userId,
      channel: 'WHATSAPP',
      optedOutAt: new Date(),
    },
  });

  // Agendamentos: passados concluídos, futuros confirmados, um cancelado e um
  // no-show. Horários escolhidos dentro da jornada de cada profissional.
  const bookingSpecs = [
    { staff: 0, service: 0, date: localDate(-14), time: '10:00', status: 'COMPLETED' as const },
    { staff: 0, service: 1, date: localDate(-7), time: '15:00', status: 'COMPLETED' as const },
    { staff: 1, service: 2, date: localDate(-5), time: '14:00', status: 'NO_SHOW' as const },
    { staff: 2, service: 4, date: localDate(-2), time: '12:00', status: 'CANCELLED' as const },
    { staff: 0, service: 0, date: localDate(1), time: '09:30', status: 'CONFIRMED' as const },
    { staff: 1, service: 1, date: localDate(2), time: '13:30', status: 'CONFIRMED' as const },
    { staff: 2, service: 3, date: localDate(5), time: '11:00', status: 'PENDING' as const },
  ];

  for (const [i, spec] of bookingSpecs.entries()) {
    const service = services[spec.service]!;
    const startsAt = instant(spec.date, spec.time);
    const endsAt = new Date(startsAt.getTime() + service.durationMin * 60_000);
    const blockedUntil = new Date(endsAt.getTime() + service.bufferMin * 60_000);
    await tx.booking.create({
      data: {
        tenantId: tenant.id,
        customerId: customers[i]!.id,
        staffId: staff[spec.staff]!.id,
        serviceId: service.id,
        startsAt,
        endsAt,
        blockedUntil,
        status: spec.status,
        priceCents: service.priceCents,
        source: 'PORTAL',
        confirmedAt: spec.status === 'PENDING' ? null : startsAt,
        completedAt: spec.status === 'COMPLETED' ? endsAt : null,
        cancelledAt: spec.status === 'CANCELLED' ? new Date() : null,
        noShowAt: spec.status === 'NO_SHOW' ? endsAt : null,
      },
    });
  }

  // Clube do salão com um assinante ativo e saldo de créditos.
  const plan = await tx.membershipPlan.create({
    data: {
      tenantId: tenant.id,
      name: 'Clube Carlos — 2 cortes/mês',
      priceCents: 7900,
      cycle: 'MONTHLY',
      benefits: {
        create: [
          { tenantId: tenant.id, serviceId: services[0]!.id, quantityPerCycle: 2 },
          { tenantId: tenant.id, serviceId: services[1]!.id, quantityPerCycle: 1 },
        ],
      },
    },
  });

  const membership = await tx.membership.create({
    data: {
      tenantId: tenant.id,
      customerId: customers[0]!.id,
      planId: plan.id,
      status: 'ACTIVE',
      // Assinou antes do último reajuste: o plano custa R$ 79,00 hoje, mas a
      // cobrança dela continua R$ 69,00. É o caso que prova, no dado de
      // desenvolvimento, que preço contratado e preço corrente são coisas
      // diferentes — quem ler `plan.priceCents` para cobrar quebra o seed.
      contractedPriceCents: 6900,
      cardBrand: 'VISA',
      cardLastFour: '4242',
      currentPeriodEnd: instant(localDate(20), '00:00'),
    },
  });

  // Saldo é a SOMA do ledger, nunca um contador: 2 créditos concedidos, 1 usado.
  await tx.creditLedger.createMany({
    data: [
      { tenantId: tenant.id, membershipId: membership.id, serviceId: services[0]!.id, delta: 2, reason: 'cycle_grant' },
      { tenantId: tenant.id, membershipId: membership.id, serviceId: services[1]!.id, delta: 1, reason: 'cycle_grant' },
      { tenantId: tenant.id, membershipId: membership.id, serviceId: services[0]!.id, delta: -1, reason: 'booking_consumed' },
    ],
  });

  // Conta de recebimento aprovada e assinatura B2B ativa.
  await tx.asaasAccount.create({
    data: {
      tenantId: tenant.id,
      asaasAccountId: 'seed-asaas-account-a',
      walletId: 'seed-wallet-a',
      apiKeyEnc: 'seed-encrypted-placeholder',
      pixKey: 'carlos@exemplo.com.br',
      kycStatus: 'APPROVED',
    },
  });
  await tx.platformSub.create({
    data: {
      tenantId: tenant.id,
      stripeCustomerId: 'cus_seed_a',
      stripeSubscriptionId: 'sub_seed_a',
      plan: 'EQUIPE',
      status: 'ACTIVE',
      currentPeriodEnd: instant(localDate(25), '00:00'),
      trialEndedAt: instant(localDate(-30), '00:00'),
    },
  });
}

async function seedTenantB(tx: TenantTransaction): Promise<void> {
  const tenant = await tx.tenant.create({
    data: {
      id: SEED.tenantB,
      slug: 'petspaluna',
      name: 'Pet Spa Luna',
      document: '98765432000155',
      timezone: TZ,
      themePreset: 'pet-friendly',
      status: 'TRIAL',
      trialBookingsUsed: 3,
    },
  });

  const owner = await tx.user.create({ data: { phone: phone(900), name: 'Luna Ferreira' } });
  await tx.tenantMember.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'OWNER' } });

  const staffUser = await tx.user.create({ data: { phone: phone(901), name: 'Marcos Tavares' } });
  const staffMember = await tx.tenantMember.create({
    data: { tenantId: tenant.id, userId: staffUser.id, role: 'STAFF' },
  });
  const staffProfile = await tx.staffProfile.create({
    data: { tenantId: tenant.id, tenantMemberId: staffMember.id, bio: 'Banho e tosa.' },
  });
  await tx.workingHours.createMany({
    data: [1, 2, 3, 4, 5].map((weekday) => ({
      tenantId: tenant.id,
      staffId: staffProfile.id,
      weekday,
      startTime: wallClock('08:00'),
      endTime: wallClock('17:00'),
    })),
  });

  const service = await tx.service.create({
    data: {
      tenantId: tenant.id,
      name: 'Banho e tosa',
      durationMin: 60,
      bufferMin: 15,
      priceCents: 9000,
      paymentMode: 'DEPOSIT',
      depositPercent: 50,
    },
  });
  await tx.staffService.create({
    data: { tenantId: tenant.id, staffId: staffProfile.id, serviceId: service.id },
  });

  const customerUser = await tx.user.create({ data: { phone: phone(902), name: 'Renata Vidal' } });
  const customer = await tx.tenantMember.create({
    data: { tenantId: tenant.id, userId: customerUser.id, role: 'CUSTOMER' },
  });

  const startsAt = instant(localDate(3), '09:00');
  await tx.booking.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      staffId: staffProfile.id,
      serviceId: service.id,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      blockedUntil: new Date(startsAt.getTime() + 75 * 60_000),
      status: 'CONFIRMED',
      priceCents: service.priceCents,
      confirmedAt: new Date(),
    },
  });

  // KYC pendente de propósito: é o caminho degradado que a F4.1 precisa testar
  // (salão opera em ON_SITE enquanto a subconta não é aprovada).
  await tx.asaasAccount.create({
    data: {
      tenantId: tenant.id,
      asaasAccountId: 'seed-asaas-account-b',
      walletId: 'seed-wallet-b',
      apiKeyEnc: 'seed-encrypted-placeholder',
      pixKey: '+5548900000900',
      kycStatus: 'PENDING',
    },
  });
}

async function main(): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // A RLS está com FORCE: nem o dono das tabelas escreve em dois tenants
      // sem assumir o papel de plataforma. Mesmo flag que `asPlatformAdmin()`.
      await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      await wipe(tx);
      await seedTenantA(tx);
      await seedTenantB(tx);
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  console.log('Seed aplicado:');
  console.log(`  - ${SEED.tenantA} (/carlosbarber) — completo`);
  console.log(`  - ${SEED.tenantB} (/petspaluna)   — mínimo, para testes de isolamento`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
