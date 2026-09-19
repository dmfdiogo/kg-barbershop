import { Prisma } from '@prisma/client';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';
import { listAllTenantIds } from '@/lib/tenant/context';
import {
  PaymentWebhookValidationError,
  planPaymentTransition,
  resolveBookingConfirmation,
  resolveBookingRelease,
  type LocalPaymentState,
  type PaymentBookingEffect,
} from '@/lib/payments/state';
import type { PaymentWebhookEvent, PaymentWebhookResult } from '@/lib/payments/webhook';
import {
  confirmBookingInTransaction,
  discoverParticipants,
  emitBookingEvent,
  type BookingConfirmedEvent,
} from '@/lib/booking/confirm';

/**
 * Núcleo persistente do webhook de pagamentos (tarefa F4.0).
 *
 * A rota `app/api/webhooks/payments/route.ts` verifica o token e faz o parse;
 * este módulo é quem toca no banco. Ele pressupõe payload JÁ autenticado —
 * nunca o chame a partir de entrada não verificada.
 *
 * ISOLAMENTO. O webhook é um ator de SISTEMA: não tem tenant no caminho. Como
 * `Payment` tem RLS (contexto-comum.md §4), a resolução percorre os ids com
 * `listAllTenantIds()` e lê cada um por `forTenant()`, com a RLS em vigor — não
 * há bypass. Toda escrita de negócio é escopada. A busca é O(tenants); quando
 * houver escala, o caminho é uma tabela de mapeamento global, não abrir mão da
 * RLS.
 *
 * DUAS FASES. Primeiro resolve, em LEITURA, o tenant dono do evento (a
 * cobrança pelo `asaasId`, ou a conta pelo `asaasAccountId`). Só então abre UMA
 * transação no tenant certo para gravar. Sem isso, cada tenant sem o pagamento
 * tentaria um insert em `WebhookEvent` para depois desfazer.
 *
 * IDEMPOTÊNCIA. `WebhookEvent` tem `unique(provider, eventId)`. O insert é a
 * PRIMEIRA operação da transação: reentrega viola a unique (P2002), a transação
 * desfaz e a rota responde 200 sem reprocessar. Se o processamento falhar
 * depois, a transação inteira desfaz — inclusive o insert — e a reentrega
 * consegue processar. É o contrato da F0.3, agora garantido pelo banco.
 *
 * REENTRÂNCIA (`contexto-comum.md` §4). Tudo roda na callback do client
 * escopado, que pode ser reexecutada sob P2034. Não há chamada externa, e toda
 * escrita decorre do estado relido na própria transação — reexecutar converge.
 *
 * VALOR DO PAYLOAD. `planPaymentTransition` confronta o valor com o `Payment`
 * local e a consistência de `refundedCents` com o tipo do evento. Payload é
 * entrada não confiável.
 */
export class WebhookProcessingError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookProcessingError';
  }
}

export interface ProcessPaymentWebhookOptions {
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
}

export async function processPaymentWebhook(
  event: PaymentWebhookEvent,
  rawBody: string,
  options: ProcessPaymentWebhookOptions = {},
): Promise<PaymentWebhookResult> {
  const now = options.now ?? new Date();
  const tenantId = await resolveTenantForEvent(event);

  if (!tenantId) {
    throw new WebhookProcessingError(
      404,
      event.type === 'MERCHANT_KYC_UPDATED'
        ? 'Conta de recebimento desconhecida para o evento de KYC.'
        : 'Cobrança desconhecida para o evento recebido.',
    );
  }

  try {
    const outcome = await forTenant(tenantId, (tx) =>
      processInTransaction(tx, tenantId, event, rawBody, now),
    );
    // PÓS-COMMIT, e fora da callback de propósito: o client escopado reexecuta
    // a transação em caso de `P2034`, e um handler chamado lá dentro mandaria
    // duas mensagens para o cliente. O contrato é o mesmo de `confirmBooking`.
    if (outcome.confirmed) {
      await emitBookingEvent(outcome.confirmed);
    }
    return outcome.result;
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }
    throw error;
  }
}

/** Resolve, em leitura e sob RLS, a qual tenant o evento pertence. */
async function resolveTenantForEvent(event: PaymentWebhookEvent): Promise<string | null> {
  const tenantIds = await listAllTenantIds();

  for (const tenantId of tenantIds) {
    const found = await forTenant(tenantId, async (tx) => {
      if (event.type === 'MERCHANT_KYC_UPDATED') {
        const merchant = event.data.merchant;
        if (!merchant) return false;
        const account = await tx.asaasAccount.findFirst({
          where: { tenantId, asaasAccountId: merchant.accountId },
          select: { id: true },
        });
        return account !== null;
      }
      const charge = event.data.charge;
      if (!charge) return false;
      const payment = await tx.payment.findFirst({
        where: { tenantId, provider: event.provider, asaasId: charge.id },
        select: { id: true },
      });
      return payment !== null;
    });
    if (found) return tenantId;
  }

  return null;
}

async function processInTransaction(
  tx: TenantTransaction,
  tenantId: string,
  event: PaymentWebhookEvent,
  rawBody: string,
  now: Date,
): Promise<{ result: PaymentWebhookResult; confirmed?: BookingConfirmedEvent }> {
  const eventRow = await tx.webhookEvent.create({
    data: {
      provider: event.provider,
      eventId: event.eventId,
      payload: parseRawPayload(rawBody, event),
    },
    select: { id: true },
  });

  const applied =
    event.type === 'MERCHANT_KYC_UPDATED'
      ? await applyMerchantKyc(tx, tenantId, event)
      : await applyChargeEvent(tx, tenantId, event, now);

  await tx.webhookEvent.update({
    where: { id: eventRow.id },
    data: { processedAt: now },
  });

  return {
    result: { status: 200, body: { received: true, applied: applied.description } },
    confirmed: applied.confirmed,
  };
}

interface AppliedEffect {
  description: string;
  /**
   * Evento a emitir DEPOIS do commit, quando este webhook foi o que confirmou o
   * agendamento. `undefined` em qualquer outro caso — inclusive na reentrega,
   * porque aí a confirmação não aconteceu aqui.
   */
  confirmed?: BookingConfirmedEvent;
}

async function applyMerchantKyc(
  tx: TenantTransaction,
  tenantId: string,
  event: PaymentWebhookEvent,
): Promise<AppliedEffect> {
  const merchant = event.data.merchant;
  if (!merchant) {
    throw new WebhookProcessingError(400, 'Evento de KYC sem dados da conta.');
  }

  const account = await tx.asaasAccount.findFirst({
    where: { tenantId, asaasAccountId: merchant.accountId },
    select: { id: true, walletId: true, kycStatus: true },
  });
  if (!account) {
    throw new WebhookProcessingError(404, 'Conta de recebimento não encontrada.');
  }
  if (account.walletId !== merchant.walletId) {
    throw new WebhookProcessingError(400, 'Carteira do payload diverge do registro local.');
  }

  if (account.kycStatus !== merchant.kycStatus) {
    await tx.asaasAccount.update({
      where: { id: account.id },
      data: { kycStatus: merchant.kycStatus },
    });
  }

  return { description: `merchant:${account.id}:${merchant.kycStatus}` };
}

async function applyChargeEvent(
  tx: TenantTransaction,
  tenantId: string,
  event: PaymentWebhookEvent,
  now: Date,
): Promise<AppliedEffect> {
  const charge = event.data.charge;
  if (!charge) {
    throw new WebhookProcessingError(400, 'Evento de cobrança sem dados da cobrança.');
  }

  const payment = await tx.payment.findFirst({
    where: { tenantId, provider: event.provider, asaasId: charge.id },
    select: { id: true },
  });
  if (!payment) {
    throw new WebhookProcessingError(404, 'Cobrança não encontrada no tenant do evento.');
  }

  // Trava a linha do pagamento ANTES de decidir. Sem isto, dois webhooks
  // concorrentes (ex.: pagamento e estorno) leriam PENDING, planejariam em
  // separado e o último commit regrediria o estado. Com o FOR UPDATE, o segundo
  // espera, relê o estado já commitado e decide pelo estado final.
  await tx.$queryRaw`SELECT id FROM payment WHERE id = ${payment.id} FOR UPDATE`;

  const locked = await tx.payment.findFirst({
    where: { id: payment.id },
    select: {
      id: true,
      bookingId: true,
      status: true,
      amountCents: true,
      paidAt: true,
      asaasId: true,
    },
  });
  if (!locked) {
    throw new WebhookProcessingError(404, 'Cobrança não encontrada no tenant do evento.');
  }

  const local: LocalPaymentState = {
    status: locked.status,
    amountCents: locked.amountCents,
    paidAt: locked.paidAt,
    asaasId: locked.asaasId,
  };

  let plan;
  try {
    plan = planPaymentTransition(local, {
      type: event.type,
      occurredAt: event.occurredAt,
      charge,
    });
  } catch (error) {
    if (error instanceof PaymentWebhookValidationError) {
      throw new WebhookProcessingError(400, error.message);
    }
    throw error;
  }

  let description: string;
  if (plan.kind === 'applied') {
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: plan.status, paidAt: plan.paidAt },
    });
    // Estorno aplicado gera LANÇAMENTO. O valor do payload é cumulativo
    // (`refundedCents` é o total estornado da cobrança), então a linha guarda só
    // o delta ainda não registrado. Isso torna o lançamento idempotente por
    // construção: reentrega para na unique de `webhook_event`; evento fora de
    // ordem ou repetido com valor não maior que o já registrado não cria linha.
    if (plan.status === 'REFUNDED' || plan.status === 'PARTIALLY_REFUNDED') {
      await recordRefundLedger(tx, tenantId, payment.id, event, charge);
    }
    description = `payment:${payment.id}:${plan.status}`;
  } else if (plan.kind === 'already-applied') {
    description = `payment:${payment.id}:${plan.status}:already`;
  } else {
    description = `payment:${payment.id}:${plan.current}:ignored:${plan.reason}`;
  }

  let confirmed: BookingConfirmedEvent | undefined;
  if (plan.kind !== 'ignored') {
    confirmed = await applyBookingEffect(tx, locked.bookingId, plan.bookingEffect, now);
  }

  return { description, confirmed };
}

/**
 * Registra o lançamento do estorno. `charge.refundedCents` é o acumulado da
 * cobrança no provedor; a soma local dos lançamentos é o acumulado do lado da
 * aplicação. Só o delta positivo vira linha — o que mantém o extrato correto
 * mesmo quando um evento com valor estagnado chega depois de um maior.
 *
 * Sem contador mutável no `Payment`: como no `credit_ledger`, o total estornado
 * é derivado da soma das linhas, e não há como divergir por atualização perdida.
 */
async function recordRefundLedger(
  tx: TenantTransaction,
  tenantId: string,
  paymentId: string,
  event: PaymentWebhookEvent,
  charge: { refundedCents: number },
): Promise<void> {
  const aggregate = await tx.refund.aggregate({
    where: { paymentId },
    _sum: { amountCents: true },
  });
  const alreadyRefunded = aggregate._sum.amountCents ?? 0;
  const delta = charge.refundedCents - alreadyRefunded;
  if (delta <= 0) {
    return;
  }

  await tx.refund.create({
    data: {
      tenantId,
      paymentId,
      provider: event.provider,
      amountCents: delta,
      occurredAt: new Date(event.occurredAt),
    },
  });
}

/**
 * Aplica ao agendamento o efeito do evento de pagamento.
 *
 * CONFIRMAR AQUI PRECISA PASSAR PELO NÚCLEO DA F3.2, não por um `update` seco.
 * Este é o caminho de TODO agendamento pré-pago: o portal deixa o hold, manda
 * para o checkout e quem confirma é este webhook, assincronamente. Enquanto
 * confirmava por conta própria, os participantes de transação e os eventos
 * pós-commit não rodavam para esses agendamentos — a trial por valor nunca
 * contava o agendamento pago (o tenant ficava em trial para sempre), e nem
 * confirmação nem lembrete D-1/H-2 eram agendados, que é justamente a função
 * do produto. O bug não aparecia em teste de fase porque cada fase verificava o
 * seu próprio caminho: a F3 confirma no local, a F4 cobra, e ninguém olhou a
 * costura. Achado pelo agente da F5.2 ao procurar onde pendurar o crédito.
 *
 * Devolve o evento de confirmação para o chamador emitir APÓS o commit — nada
 * externo pode sair daqui dentro, porque o client escopado reexecuta a callback
 * em caso de `P2034`.
 */
async function applyBookingEffect(
  tx: TenantTransaction,
  bookingId: string,
  effect: PaymentBookingEffect,
  now: Date,
): Promise<BookingConfirmedEvent | undefined> {
  if (effect === 'none') {
    return undefined;
  }

  const booking = await tx.booking.findFirst({
    where: { id: bookingId },
    select: { id: true, tenantId: true, status: true, customerId: true },
  });
  if (!booking) {
    // Pagamento existe e agendamento não: inconsistência de dado, não fluxo
    // esperado. Aborta para o evento não ser marcado como processado.
    throw new WebhookProcessingError(
      500,
      `Agendamento ${bookingId} não encontrado para o pagamento.`,
    );
  }

  if (effect === 'confirm') {
    const resolution = resolveBookingConfirmation(booking.status);
    if (resolution.kind !== 'confirmed') {
      // Já confirmado (reentrega) ou em estado que não confirma: nada a fazer e,
      // principalmente, nenhum evento — senão a reentrega do webhook dispararia
      // uma segunda mensagem de confirmação para o cliente.
      return undefined;
    }
    if (!booking.customerId) {
      // `booking_customer_required` proíbe CONFIRMED sem cliente. Chegar aqui é
      // pagamento ligado a HOLD anônimo — bug de fluxo, não estado de negócio.
      throw new WebhookProcessingError(
        500,
        'Confirmação por pagamento exige agendamento com cliente identificado.',
      );
    }
    const outcome = await confirmBookingInTransaction(tx, {
      tenantId: booking.tenantId,
      bookingId: booking.id,
      now,
      participants: discoverParticipants(),
    });
    return {
      type: 'BookingConfirmed',
      tenantId: outcome.booking.tenantId,
      bookingId: outcome.booking.id,
      occurredAt: now,
      customerId: outcome.booking.customerId ?? '',
      staffId: outcome.booking.staffId,
      serviceId: outcome.booking.serviceId,
      startsAt: outcome.booking.startsAt,
      endsAt: outcome.booking.endsAt,
      priceCents: outcome.booking.priceCents,
      previousStatus: outcome.previousStatus as 'HOLD' | 'PENDING',
    };
  }

  // effect === 'release' — recusa/Pix expirado devolve o slot.
  const resolution = resolveBookingRelease(booking.status);
  if (resolution.kind !== 'cancelled') {
    return;
  }

  if (!booking.customerId) {
    // HOLD anônimo não pode virar CANCELLED (exigiria cliente). Apagar libera o
    // intervalo da exclusion constraint exatamente como um cancelamento.
    await tx.booking.delete({ where: { id: booking.id } });
    return;
  }

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledBy: null,
      cancellationReason: 'payment_not_approved',
    },
  });
}

function parseRawPayload(rawBody: string, event: PaymentWebhookEvent): Prisma.InputJsonValue {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Prisma.InputJsonValue;
    }
  } catch {
    // Corpo não-JSON já foi recusado pelo parser; aqui é defesa extra.
  }
  return event as unknown as Prisma.InputJsonValue;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  if (code === 'P2002' || code === '23505') {
    return true;
  }
  const meta = (error as { meta?: { code?: unknown } }).meta;
  return meta?.code === 'P2002' || meta?.code === '23505';
}
