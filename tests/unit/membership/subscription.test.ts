// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  detectCardBrand,
  extractPayerIpFromHeaders,
  incomingStatusForMembershipEvent,
  lastFourDigits,
  MembershipPayloadError,
  planMembershipTransition,
  providerCycleFor,
  resolveCancellationCreditPolicy,
  validateMembershipPayload,
  type MembershipWebhookSubscriptionData,
  type MembershipWebhookEventType,
} from '@/lib/membership/subscription';

/**
 * Máquina de estados e auxiliares puros da assinatura do clube (tarefa F5.1),
 * sem banco. Prova o que a F4.0 provou para pagamentos: decisão por ESTADO
 * FINAL, payload como entrada não confiável, preço congelado e recusa de ciclo
 * que o port do provider não suporta.
 */

function payload(
  overrides: Partial<MembershipWebhookSubscriptionData> = {},
): MembershipWebhookSubscriptionData {
  return {
    id: 'sub_mock_1',
    accountId: 'acc_mock_1',
    customerId: 'member_1',
    planId: 'plan_1',
    membershipId: 'membership_1',
    status: 'ACTIVE',
    amountCents: 6900,
    currentPeriodEnd: '2026-02-20T00:00:00.000Z',
    ...overrides,
  };
}

function local(overrides: Partial<Parameters<typeof planMembershipTransition>[0]> = {}) {
  return {
    status: 'ACTIVE' as const,
    currentPeriodEnd: new Date('2026-01-20T00:00:00.000Z'),
    ...overrides,
  };
}

function incoming(type: MembershipWebhookEventType, data = payload()) {
  return incomingStatusForMembershipEvent(type, data);
}

describe('membership: transições de status', () => {
  it('aplica falha, cancelamento e expiração a partir de ACTIVE', () => {
    expect(planMembershipTransition(local(), 'PAST_DUE', { type: 'SUBSCRIPTION_PAYMENT_FAILED' })).toMatchObject({
      kind: 'applied',
      status: 'PAST_DUE',
    });
    expect(planMembershipTransition(local(), 'CANCELED', { type: 'SUBSCRIPTION_CANCELED' })).toMatchObject({
      kind: 'applied',
      status: 'CANCELED',
    });
    expect(planMembershipTransition(local(), 'EXPIRED', { type: 'SUBSCRIPTION_EXPIRED' })).toMatchObject({
      kind: 'applied',
      status: 'EXPIRED',
    });
  });

  it('reativa de PAST_DUE para ACTIVE na renovação', () => {
    const plan = planMembershipTransition(
      local({ status: 'PAST_DUE' }),
      'ACTIVE',
      { type: 'SUBSCRIPTION_CYCLE_RENEWED', currentPeriodEnd: new Date('2026-02-20T00:00:00.000Z') },
    );
    expect(plan).toMatchObject({ kind: 'applied', status: 'ACTIVE' });
  });

  it('CANCELED e EXPIRED são terminais: renovação atrasada não ressuscita', () => {
    expect(
      planMembershipTransition(local({ status: 'CANCELED' }), 'ACTIVE', {
        type: 'SUBSCRIPTION_CYCLE_RENEWED',
      }),
    ).toMatchObject({ kind: 'ignored', reason: 'terminal' });
    expect(
      planMembershipTransition(local({ status: 'EXPIRED' }), 'PAST_DUE', {
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
      }),
    ).toMatchObject({ kind: 'ignored', reason: 'terminal' });
  });

  it('reentrega do mesmo estado é already-applied e não regride', () => {
    expect(
      planMembershipTransition(local({ status: 'PAST_DUE' }), 'PAST_DUE', {
        type: 'SUBSCRIPTION_PAYMENT_FAILED',
      }),
    ).toMatchObject({ kind: 'already-applied', status: 'PAST_DUE' });
  });

  it('renovação avança o período somente quando ele de fato avança', () => {
    const applied = planMembershipTransition(local(), 'ACTIVE', {
      type: 'SUBSCRIPTION_CYCLE_RENEWED',
      currentPeriodEnd: new Date('2026-02-20T00:00:00.000Z'),
    });
    expect(applied).toMatchObject({ kind: 'applied', status: 'ACTIVE' });
    if (applied.kind === 'applied') {
      expect(applied.currentPeriodEnd?.toISOString()).toBe('2026-02-20T00:00:00.000Z');
    }

    // Período igual ou anterior: reentrega, não crédito duplicado.
    expect(
      planMembershipTransition(local(), 'ACTIVE', {
        type: 'SUBSCRIPTION_CYCLE_RENEWED',
        currentPeriodEnd: new Date('2026-01-20T00:00:00.000Z'),
      }),
    ).toMatchObject({ kind: 'already-applied', status: 'ACTIVE' });
  });
});

describe('membership: alvo do evento por tipo', () => {
  it('exige status coerente com o tipo', () => {
    expect(incoming('SUBSCRIPTION_CYCLE_RENEWED', payload({ status: 'ACTIVE' }))).toBe('ACTIVE');
    expect(incoming('SUBSCRIPTION_PAYMENT_FAILED', payload({ status: 'PAST_DUE' }))).toBe('PAST_DUE');
    expect(incoming('SUBSCRIPTION_CANCELED', payload({ status: 'CANCELED' }))).toBe('CANCELED');
    expect(incoming('SUBSCRIPTION_EXPIRED', payload({ status: 'EXPIRED' }))).toBe('EXPIRED');
  });

  it('recusa tipo e status incoerentes', () => {
    expect(() => incoming('SUBSCRIPTION_CYCLE_RENEWED', payload({ status: 'PAST_DUE' }))).toThrow(
      MembershipPayloadError,
    );
    expect(() => incoming('SUBSCRIPTION_PAYMENT_FAILED', payload({ status: 'ACTIVE' }))).toThrow(
      MembershipPayloadError,
    );
  });
});

describe('membership: payload é entrada não confiável', () => {
  const state = {
    id: 'membership_1',
    planId: 'plan_1',
    status: 'ACTIVE' as const,
    contractedPriceCents: 6900,
    asaasSubscriptionId: 'sub_mock_1',
    currentPeriodEnd: new Date('2026-01-20T00:00:00.000Z'),
  };

  it('aceita payload consistente com o registro local', () => {
    expect(() => validateMembershipPayload(state, payload())).not.toThrow();
  });

  it('confronta o valor com o preço CONTRATADO, não com o preço corrente do plano', () => {
    expect(() =>
      validateMembershipPayload(state, payload({ amountCents: 7900 })),
    ).toThrow(MembershipPayloadError);
  });

  it('recusa assinatura, vínculo local e plano divergentes', () => {
    expect(() => validateMembershipPayload(state, payload({ id: 'sub_outro' }))).toThrow(
      MembershipPayloadError,
    );
    expect(() =>
      validateMembershipPayload(state, payload({ membershipId: 'membership_outro' })),
    ).toThrow(MembershipPayloadError);
    expect(() => validateMembershipPayload(state, payload({ planId: 'plan_outro' }))).toThrow(
      MembershipPayloadError,
    );
  });

  it('recusa valor inválido e data inválida', () => {
    expect(() => validateMembershipPayload(state, payload({ amountCents: 0 }))).toThrow(
      MembershipPayloadError,
    );
    expect(() =>
      validateMembershipPayload(state, payload({ currentPeriodEnd: 'não é data' })),
    ).toThrow(MembershipPayloadError);
  });
});

describe('membership: ciclos suportados pelo port', () => {
  it('mapeia apenas os ciclos que o provider aceita', () => {
    expect(providerCycleFor('MONTHLY')).toBe('MONTHLY');
    expect(providerCycleFor('QUARTERLY')).toBe('QUARTERLY');
    expect(providerCycleFor('YEARLY')).toBe('YEARLY');
    expect(providerCycleFor('WEEKLY')).toBeNull();
    expect(providerCycleFor('BIWEEKLY')).toBeNull();
    expect(providerCycleFor('SEMIANNUALLY')).toBeNull();
  });
});

describe('membership: IP do pagador', () => {
  it('extrai o primeiro IP do header, na ordem do checkout', () => {
    expect(
      extractPayerIpFromHeaders(new Headers({ 'x-forwarded-for': '8.8.8.8, 10.0.0.1' })),
    ).toBe('8.8.8.8');
    expect(extractPayerIpFromHeaders(new Headers({ 'x-real-ip': '1.1.1.1' }))).toBe('1.1.1.1');
    expect(extractPayerIpFromHeaders(new Headers({ 'cf-connecting-ip': '9.9.9.9' }))).toBe(
      '9.9.9.9',
    );
  });

  it('devolve null quando o header está ausente ou sem IP válido', () => {
    expect(extractPayerIpFromHeaders(new Headers())).toBeNull();
    expect(
      extractPayerIpFromHeaders(new Headers({ 'x-forwarded-for': 'unknown, desconhecido' })),
    ).toBeNull();
  });
});

describe('membership: cartão para exibição', () => {
  it('detecta a marca sem persistir o PAN', () => {
    expect(detectCardBrand('4111 1111 1111 1111')).toBe('VISA');
    expect(detectCardBrand('5555 5555 5555 4444')).toBe('MASTERCARD');
    expect(detectCardBrand('378282246310005')).toBe('AMEX');
    expect(detectCardBrand('0000')).toBeNull();
  });

  it('guarda apenas os quatro últimos dígitos', () => {
    expect(lastFourDigits('4111 1111 1111 4242')).toBe('4242');
  });
});

describe('membership: política de créditos ao cancelar', () => {
  it('cancelamento comum mantém os créditos até o fim do ciclo e depois expira', () => {
    expect(resolveCancellationCreditPolicy('CUSTOMER')).toEqual({
      actor: 'CUSTOMER',
      effective: 'IMMEDIATE',
      creditDisposition: 'USE_UNTIL_PERIOD_END_THEN_EXPIRE',
    });
    expect(resolveCancellationCreditPolicy('OWNER').creditDisposition).toBe(
      'USE_UNTIL_PERIOD_END_THEN_EXPIRE',
    );
  });

  it('cancelamento imediato (abuso) forfeita os créditos na hora', () => {
    expect(
      resolveCancellationCreditPolicy('OWNER', { immediate: true }).creditDisposition,
    ).toBe('FORFEIT_NOW');
  });
});
