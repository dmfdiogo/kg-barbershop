// @vitest-environment node
import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';

import {
  constructStripeWebhookEvent,
  getStripeWebhookSecret,
  StripeWebhookConfigError,
  translateStripeEvent,
} from '@/lib/billing/stripe-webhook';

/**
 * Verificação e tradução do webhook REAL do Stripe (F8.1-B), sem rede e sem
 * chave. A assinatura é forjada com `generateTestHeaderString`, o mesmo
 * mecanismo que o Stripe usa para assinar de verdade.
 *
 * O que estas provas cobrem: assinatura válida, inválida e replay; tradução dos
 * cinco eventos; e a armadilha do `current_period_end`, que vive no ITEM.
 */

const SECRET = 'whsec_unit_test_secret';

function subscriptionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_unit_1',
    object: 'subscription',
    customer: 'cus_unit_1',
    currency: 'brl',
    status: 'active',
    cancel_at_period_end: false,
    created: 1_760_000_000,
    items: {
      object: 'list',
      data: [
        {
          id: 'si_unit_1',
          object: 'subscription_item',
          // `current_period_end` mora AQUI, no item — não na assinatura.
          current_period_end: 1_770_000_000,
          price: {
            id: 'price_unit_solo',
            object: 'price',
            unit_amount: 3990,
            currency: 'brl',
            lookup_key: 'bom_horario_solo_mensal',
            metadata: { plan_code: 'SOLO' },
          },
        },
      ],
    },
    ...overrides,
  };
}

function stripeEvent(
  type: string,
  object: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'evt_unit_1',
    object: 'event',
    type,
    created: 1_760_000_100,
    data: { object },
    ...overrides,
  };
}

function sign(payload: string, timestamp?: number): string {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: SECRET,
    ...(timestamp ? { timestamp } : {}),
  });
}

describe('constructStripeWebhookEvent', () => {
  it('aceita assinatura válida e devolve o evento', () => {
    const payload = JSON.stringify(stripeEvent('payment_intent.succeeded', {}));
    const event = constructStripeWebhookEvent(payload, sign(payload), SECRET);
    expect(event.type).toBe('payment_intent.succeeded');
    expect(event.id).toBe('evt_unit_1');
  });

  it('recusa assinatura inválida', () => {
    const payload = JSON.stringify(stripeEvent('payment_intent.succeeded', {}));
    expect(() => constructStripeWebhookEvent(payload, 'assinatura-errada', SECRET)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });

  it('recusa timestamp velho (replay)', () => {
    const payload = JSON.stringify(stripeEvent('payment_intent.succeeded', {}));
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // > 300s de tolerância
    expect(() =>
      constructStripeWebhookEvent(payload, sign(payload, oldTimestamp), SECRET),
    ).toThrow(Stripe.errors.StripeSignatureVerificationError);
  });

  it('recusa header ausente', () => {
    const payload = JSON.stringify(stripeEvent('payment_intent.succeeded', {}));
    expect(() => constructStripeWebhookEvent(payload, undefined, SECRET)).toThrow(
      Stripe.errors.StripeSignatureVerificationError,
    );
  });
});

describe('getStripeWebhookSecret', () => {
  it('falha explícito quando a variável não está configurada', () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect(() => getStripeWebhookSecret()).toThrow(StripeWebhookConfigError);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previous;
    }
  });
});

describe('translateStripeEvent', () => {
  it('ignora tipo que não mapeia para o produto', async () => {
    const event = stripeEvent('payment_intent.succeeded', {}) as unknown as Stripe.Event;
    await expect(translateStripeEvent(event)).resolves.toBeNull();
  });

  it('traduz customer.subscription.created para SUBSCRIPTION_CREATED', async () => {
    const event = stripeEvent(
      'customer.subscription.created',
      subscriptionPayload(),
    ) as unknown as Stripe.Event;

    const translated = await translateStripeEvent(event);
    expect(translated).not.toBeNull();
    expect(translated!.provider).toBe('stripe');
    expect(translated!.type).toBe('SUBSCRIPTION_CREATED');
    expect(translated!.eventId).toBe('evt_unit_1');
    expect(translated!.data.subscription).toMatchObject({
      id: 'sub_unit_1',
      customerId: 'cus_unit_1',
      plan: 'SOLO',
      status: 'ACTIVE',
      amountCents: 3990,
      // Lido do ITEM da assinatura, não do topo.
      currentPeriodEnd: new Date(1_770_000_000 * 1000).toISOString(),
      cancelAtPeriodEnd: false,
    });
  });

  it('traduz customer.subscription.updated para SUBSCRIPTION_UPDATED', async () => {
    const event = stripeEvent(
      'customer.subscription.updated',
      subscriptionPayload({ status: 'past_due' }),
    ) as unknown as Stripe.Event;

    const translated = await translateStripeEvent(event);
    expect(translated!.type).toBe('SUBSCRIPTION_UPDATED');
    expect(translated!.data.subscription!.status).toBe('PAST_DUE');
  });

  it('traduz customer.subscription.deleted para SUBSCRIPTION_CANCELED', async () => {
    const event = stripeEvent(
      'customer.subscription.deleted',
      subscriptionPayload({ status: 'canceled' }),
    ) as unknown as Stripe.Event;

    const translated = await translateStripeEvent(event);
    expect(translated!.type).toBe('SUBSCRIPTION_CANCELED');
    expect(translated!.data.subscription!.status).toBe('CANCELED');
  });

  it('traduz invoice.paid para INVOICE_PAID com status ACTIVE', async () => {
    const invoice = {
      id: 'in_unit_1',
      object: 'invoice',
      parent: { subscription_details: { subscription: subscriptionPayload({ status: 'active' }) } },
    };
    const event = stripeEvent('invoice.paid', invoice) as unknown as Stripe.Event;

    const translated = await translateStripeEvent(event);
    expect(translated!.type).toBe('INVOICE_PAID');
    expect(translated!.data.subscription!.status).toBe('ACTIVE');
  });

  it('invoice.payment_failed força PAST_DUE mesmo com a assinatura ainda active', async () => {
    // O Stripe não muda `subscription.status` no mesmo instante da falha; o
    // TIPO do evento é que decide o alvo. O produto recusaria o contrário.
    const invoice = {
      id: 'in_unit_2',
      object: 'invoice',
      parent: { subscription_details: { subscription: subscriptionPayload({ status: 'active' }) } },
    };
    const event = stripeEvent('invoice.payment_failed', invoice) as unknown as Stripe.Event;

    const translated = await translateStripeEvent(event);
    expect(translated!.type).toBe('INVOICE_PAYMENT_FAILED');
    expect(translated!.data.subscription!.status).toBe('PAST_DUE');
  });

  it('busca a assinatura quando o evento de fatura só traz o id', async () => {
    const invoice = {
      id: 'in_unit_3',
      object: 'invoice',
      parent: { subscription_details: { subscription: 'sub_unit_1' } },
    };
    const event = stripeEvent('invoice.paid', invoice) as unknown as Stripe.Event;

    let asked: string | undefined;
    const translated = await translateStripeEvent(event, {
      retrieveSubscription: async (id) => {
        asked = id;
        return subscriptionPayload() as unknown as Stripe.Subscription;
      },
    });

    expect(asked).toBe('sub_unit_1');
    expect(translated!.type).toBe('INVOICE_PAID');
  });
});
