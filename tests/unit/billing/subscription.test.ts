// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BILLING_PLANS } from '@/lib/billing/plans';
import {
  incomingStatusForEvent,
  isSubscriptionSuspended,
  planSubscriptionTransition,
  validateSubscriptionPayload,
  SubscriptionPayloadError,
} from '@/lib/billing/subscription';
import type { BillingWebhookSubscriptionData } from '@/lib/billing/webhook';

/**
 * Máquina de estados do ciclo de cobrança (tarefa F7.2), sem banco.
 *
 * O que se prova aqui é o que a F4.0 provou para pagamentos: a decisão é por
 * ESTADO FINAL, não por ordem de chegada; o payload é entrada não confiável; e
 * a suspensão só bloqueia o novo. O comportamento persistente fica nos testes
 * de integração.
 */

function payload(
  overrides: Partial<BillingWebhookSubscriptionData> = {},
): BillingWebhookSubscriptionData {
  return {
    id: 'sub_mock_1',
    customerId: 'cus_mock_1',
    plan: 'SOLO',
    status: 'ACTIVE',
    amountCents: BILLING_PLANS.SOLO.priceCents,
    currentPeriodEnd: '2026-02-01T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

describe('billing: máquina de estados da assinatura', () => {
  it('aplica somente transições permitidas e ignora as proibidas', () => {
    expect(planSubscriptionTransition('TRIALING', 'ACTIVE')).toEqual({
      kind: 'applied',
      status: 'ACTIVE',
    });
    expect(planSubscriptionTransition('ACTIVE', 'PAST_DUE')).toEqual({
      kind: 'applied',
      status: 'PAST_DUE',
    });
    expect(planSubscriptionTransition('PAST_DUE', 'ACTIVE')).toEqual({
      kind: 'applied',
      status: 'ACTIVE',
    });

    // Proibida, mas não terminal: registra e não regride.
    expect(planSubscriptionTransition('PAST_DUE', 'TRIALING')).toMatchObject({
      kind: 'ignored',
      reason: 'stale',
    });
  });

  it('CANCELED é terminal: pagamento atrasado não ressuscita assinatura', () => {
    expect(planSubscriptionTransition('CANCELED', 'ACTIVE')).toMatchObject({
      kind: 'ignored',
      reason: 'terminal',
    });
    expect(planSubscriptionTransition('CANCELED', 'PAST_DUE')).toMatchObject({
      kind: 'ignored',
      reason: 'terminal',
    });
  });

  it('estado local igual ao alvo é evento já aplicado', () => {
    expect(planSubscriptionTransition('ACTIVE', 'ACTIVE')).toEqual({
      kind: 'already-applied',
      status: 'ACTIVE',
    });
  });

  it('só PAST_DUE e CANCELED suspendem o novo agendamento', () => {
    expect(isSubscriptionSuspended('TRIALING')).toBe(false);
    expect(isSubscriptionSuspended('ACTIVE')).toBe(false);
    expect(isSubscriptionSuspended('PAST_DUE')).toBe(true);
    expect(isSubscriptionSuspended('CANCELED')).toBe(true);
  });
});

describe('billing: alvo do evento por tipo', () => {
  it('INVOICE_PAID reativa; INVOICE_PAYMENT_FAILED suspende', () => {
    expect(incomingStatusForEvent('INVOICE_PAID', payload({ status: 'ACTIVE' }))).toBe('ACTIVE');
    expect(
      incomingStatusForEvent('INVOICE_PAYMENT_FAILED', payload({ status: 'PAST_DUE' })),
    ).toBe('PAST_DUE');
  });

  it('SUBSCRIPTION_CANCELED aceita imediato e agendado em qualquer status, recusa o resto', () => {
    expect(
      incomingStatusForEvent('SUBSCRIPTION_CANCELED', payload({ status: 'CANCELED' })),
    ).toBe('CANCELED');
    expect(
      incomingStatusForEvent(
        'SUBSCRIPTION_CANCELED',
        payload({ status: 'ACTIVE', cancelAtPeriodEnd: true }),
      ),
    ).toBe('ACTIVE');
    // Agendado fora de ACTIVE (trial de cobrança ou mensalidade atrasada) também
    // é verdade do provedor e não pode virar 400.
    expect(
      incomingStatusForEvent(
        'SUBSCRIPTION_CANCELED',
        payload({ status: 'TRIALING', cancelAtPeriodEnd: true }),
      ),
    ).toBe('TRIALING');
    expect(
      incomingStatusForEvent(
        'SUBSCRIPTION_CANCELED',
        payload({ status: 'PAST_DUE', cancelAtPeriodEnd: true }),
      ),
    ).toBe('PAST_DUE');

    expect(() =>
      incomingStatusForEvent('SUBSCRIPTION_CANCELED', payload({ status: 'PAST_DUE' })),
    ).toThrow(SubscriptionPayloadError);
  });

  it('recusa tipo e status incoerentes', () => {
    expect(() => incomingStatusForEvent('INVOICE_PAID', payload({ status: 'PAST_DUE' }))).toThrow(
      SubscriptionPayloadError,
    );
    expect(() =>
      incomingStatusForEvent('INVOICE_PAYMENT_FAILED', payload({ status: 'ACTIVE' })),
    ).toThrow(SubscriptionPayloadError);
  });
});

describe('billing: payload é entrada não confiável', () => {
  const local = { stripeSubscriptionId: 'sub_mock_1', stripeCustomerId: 'cus_mock_1' };

  it('aceita payload consistente com o registro local', () => {
    expect(() => validateSubscriptionPayload(local, payload())).not.toThrow();
  });

  it('recusa assinatura, cliente e plano divergentes', () => {
    expect(() => validateSubscriptionPayload(local, payload({ id: 'sub_outro' }))).toThrow(
      SubscriptionPayloadError,
    );
    expect(() =>
      validateSubscriptionPayload(local, payload({ customerId: 'cus_outro' })),
    ).toThrow(SubscriptionPayloadError);
    expect(() =>
      validateSubscriptionPayload(local, payload({ plan: 'ENTERPRISE' })),
    ).toThrow(SubscriptionPayloadError);
  });

  it('recusa valor que não é o preço configurado do plano', () => {
    expect(() =>
      validateSubscriptionPayload(local, payload({ amountCents: BILLING_PLANS.SOLO.priceCents + 1 })),
    ).toThrow(SubscriptionPayloadError);
  });

  it('recusa status desconhecido e data inválida', () => {
    expect(() =>
      validateSubscriptionPayload(local, payload({ status: 'WHATEVER' as never })),
    ).toThrow(SubscriptionPayloadError);
    expect(() =>
      validateSubscriptionPayload(local, payload({ currentPeriodEnd: 'não é data' })),
    ).toThrow(SubscriptionPayloadError);
  });
});
