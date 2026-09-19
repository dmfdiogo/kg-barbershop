import type { BookingSource } from '@prisma/client';
import { forTenant } from '@/lib/tenant/db';
import { listAllTenantIds } from '@/lib/tenant/context';
import type { TenantTransaction } from '@/lib/tenant/db';

/**
 * Soft lock de 10 minutos (tarefa F3.2, spec §9.1 e plano §5.2).
 *
 * Um hold é uma linha em `Booking` com `status='HOLD'`, `holdExpiresAt` e
 * `holdSessionId`. A garantia real contra double-booking é a exclusion
 * constraint `booking_no_overlap` do banco — este módulo NÃO valida
 * disponibilidade com `if`: ele apenas tenta inserir e deixa o banco decidir.
 * A violação (23P01) é traduzida para `SlotUnavailableError` pelo client
 * escopado (lib/tenant/db.ts), nunca vira 500.
 *
 * Dois cuidados que o plano exige e que vivem AQUI:
 *
 *   1. A MESMA transação apaga os holds vencidos daquele profissional antes de
 *      inserir. Sem isso, um hold abandonado e ainda não coletado continuaria
 *      bloqueando a constraint e o horário ficaria preso até o cron passar.
 *   2. O hold é amarrado a `holdSessionId` (sessão/dispositivo). Sem dono, um
 *      bot segura a agenda inteira do salão por dez minutos.
 *
 * REENTRÂNCIA (contexto-comum.md §4): a callback do client escopado pode rodar
 * duas vezes sob disputa de slot (P2034). A limpeza dos vencidos é um
 * `deleteMany` idempotente e a criação é reexecutável; se o insert colidir, a
 * transação inteira aborta (a limpeza é desfeita junto) e o retry relê o estado
 * já commitado pelo competidor, caindo em `SlotUnavailableError`.
 */

/** Duração do soft lock. É uma política de domínio, não uma constante de UI. */
export const HOLD_DURATION_MINUTES = 10;

const MINUTE_MS = 60_000;

export type HoldErrorCode = 'INVALID_INPUT' | 'SERVICE_NOT_FOUND';

/**
 * Erro de domínio do hold. `SERVICE_NOT_FOUND` também cobre serviço de OUTRO
 * tenant: a leitura é escopada e a RLS responde vazio — a resposta correta é
 * "não existe aqui", não vazar que o id existe em outro lugar.
 */
export class HoldError extends Error {
  readonly code: HoldErrorCode;
  readonly status: number;

  constructor(code: HoldErrorCode, message: string) {
    super(message);
    this.name = 'HoldError';
    this.code = code;
    this.status = code === 'INVALID_INPUT' ? 400 : 404;
  }
}

export interface CreateHoldInput {
  tenantId: string;
  /**
   * Nulo no hold anônimo, que é o caso normal: o soft lock nasce ANTES da
   * identificação por OTP, porque pedir login antes de mostrar horário derruba
   * conversão (spec §2.4). Quem amarra o hold ao dispositivo é `holdSessionId`.
   * A confirmação preenche o cliente, e a constraint `booking_customer_required`
   * impede que qualquer status além de HOLD fique sem ele.
   */
  customerId?: string | null;
  staffId: string;
  serviceId: string;
  /** Início do atendimento (UTC). A grade da F3.1 fornece este instante. */
  startsAt: Date;
  /**
   * Dono do hold (sessão/dispositivo). Obrigatório e não vazio: é o que impede
   * um único cliente de segurar a agenda inteira.
   */
  holdSessionId: string;
  source?: BookingSource;
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
}

export interface CreatedHold {
  id: string;
  tenantId: string;
  customerId: string | null;
  staffId: string;
  serviceId: string;
  startsAt: Date;
  endsAt: Date;
  blockedUntil: Date;
  priceCents: number;
  status: 'HOLD';
  holdExpiresAt: Date;
  holdSessionId: string;
}

/**
 * Cria o soft lock. Duração e preço vêm do `Service` (nunca do chamador), e o
 * `blockedUntil` inclui o buffer — o mesmo intervalo que a constraint protege.
 */
export async function createHold(input: CreateHoldInput): Promise<CreatedHold> {
  validateCreateHold(input);
  return forTenant(input.tenantId, (tx) => createHoldInTransaction(tx, input));
}

/**
 * Núcleo do hold, SEM abrir transação: o chamador entrega a transação já aberta.
 *
 * É o que permite a remarcação da F3.4 ser ATÔMICA — liberar o horário antigo e
 * criar o novo acontecem na MESMA transação, sem um caminho paralelo que
 * reimplemente a criação do hold. `createHold` é a casca pública que abre a
 * transação; quem já tem uma (reschedule) chama esta função.
 *
 * Reexecutável como toda callback do client escopado (contexto-comum.md §4): a
 * limpeza dos vencidos é `deleteMany` idempotente e o insert colide na
 * constraint, abortando a transação inteira — o retry relê o estado já
 * commitado pelo competidor.
 */
export async function createHoldInTransaction(
  tx: TenantTransaction,
  input: CreateHoldInput,
): Promise<CreatedHold> {
  validateCreateHold(input);
  const now = input.now ?? new Date();

  const service = await tx.service.findFirst({
    where: { id: input.serviceId, tenantId: input.tenantId, active: true },
    select: { durationMin: true, bufferMin: true, priceCents: true },
  });
  if (!service) {
    throw new HoldError('SERVICE_NOT_FOUND', 'Serviço não encontrado ou inativo.');
  }

  const endsAt = new Date(input.startsAt.getTime() + service.durationMin * MINUTE_MS);
  const blockedUntil = new Date(endsAt.getTime() + service.bufferMin * MINUTE_MS);
  const holdExpiresAt = new Date(now.getTime() + HOLD_DURATION_MINUTES * MINUTE_MS);

  // ANTES de inserir, na MESMA transação: libera holds vencidos do profissional.
  await deleteExpiredHoldsForStaff(tx, input.tenantId, input.staffId, now);

  const booking = await tx.booking.create({
    data: {
      tenantId: input.tenantId,
      customerId: input.customerId ?? null,
      staffId: input.staffId,
      serviceId: input.serviceId,
      startsAt: input.startsAt,
      endsAt,
      blockedUntil,
      status: 'HOLD',
      holdExpiresAt,
      holdSessionId: input.holdSessionId,
      priceCents: service.priceCents,
      source: input.source ?? 'PORTAL',
    },
  });

  return {
    id: booking.id,
    tenantId: booking.tenantId,
    customerId: booking.customerId,
    staffId: booking.staffId,
    serviceId: booking.serviceId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    blockedUntil: booking.blockedUntil,
    priceCents: booking.priceCents,
    status: 'HOLD',
    holdExpiresAt,
    holdSessionId: input.holdSessionId,
  };
}

function validateCreateHold(input: CreateHoldInput): void {
  if (!input.tenantId) throw new HoldError('INVALID_INPUT', 'tenantId é obrigatório.');
  if (!input.staffId) throw new HoldError('INVALID_INPUT', 'staffId é obrigatório.');
  if (!input.serviceId) throw new HoldError('INVALID_INPUT', 'serviceId é obrigatório.');
  if (!input.holdSessionId || input.holdSessionId.trim() === '') {
    throw new HoldError('INVALID_INPUT', 'holdSessionId é obrigatório.');
  }
  if (!(input.startsAt instanceof Date) || Number.isNaN(input.startsAt.getTime())) {
    throw new HoldError('INVALID_INPUT', 'startsAt deve ser uma data válida.');
  }
}

/**
 * Apaga os holds vencidos daquele profissional. Exportada para reuso e teste:
 * a criação de hold chama dentro da própria transação (rede de segurança
 * principal), e o cron a usa como varredura.
 *
 * Só HOLD com `holdExpiresAt <= now` é removido. HOLD sem `holdExpiresAt` é
 * anomalia de dado e a F3.1 o trata como ocupado (fail-closed) — apagá-lo aqui
 * criaria janela para double-booking.
 */
export async function deleteExpiredHoldsForStaff(
  tx: TenantTransaction,
  tenantId: string,
  staffId: string,
  now: Date,
): Promise<number> {
  const result = await tx.booking.deleteMany({
    where: {
      tenantId,
      staffId,
      status: 'HOLD',
      holdExpiresAt: { lte: now },
    },
  });
  return result.count;
}

/**
 * Rede de segurança do hold: varre todos os tenants e apaga holds vencidos.
 *
 * NÃO é o mecanismo principal — a criação de hold já limpa os vencidos do
 * profissional na mesma transação. O cron existe para os holds que ninguém
 * voltou a tentar, e por isso roda espaçado.
 *
 * Isolamento em duas camadas (contexto-comum.md §4): a enumeração global vem de
 * `listAllTenantIds()` (lib/tenant), único ponto autorizado a atravessar
 * tenants para trabalho periódico; a ESCRITA de dado de negócio continua por
 * `forTenant`, tenant a tenant, com a RLS em vigor.
 */
export async function expireStaleHolds(options: { now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();

  const tenantIds = await listAllTenantIds();

  let expired = 0;
  for (const tenantId of tenantIds) {
    const result = await forTenant(tenantId, (tx) =>
      tx.booking.deleteMany({
        where: { status: 'HOLD', holdExpiresAt: { lte: now } },
      }),
    );
    expired += result.count;
  }

  return expired;
}
