import {
  BILLING_WEBHOOK_TOKEN_HEADER,
  getBillingWebhookSecret,
  verifyBillingWebhookSignature,
  type BillingWebhookEvent,
} from '@/lib/billing/webhook';
import {
  constructStripeWebhookEvent,
  getStripeWebhookSecret,
  StripeWebhookConfigError,
  StripeWebhookTranslationError,
  translateStripeEvent,
} from '@/lib/billing/stripe-webhook';
import {
  parseBillingWebhookEvent,
  processBillingWebhook,
  WebhookProcessingError,
} from './processor';

/**
 * Webhook de billing B2B — rota de domínio, nomeada pelo negócio e não pelo
 * provider (é a URL que se cadastra no Stripe na F8.1).
 *
 * ASSUMIDA PELA F7.2 e estendida pela F8.1-B. Segue, na ordem, o contrato de
 * `contexto-comum.md` §6:
 *
 *   1. verifica a assinatura ANTES de qualquer coisa;
 *   2. parse do corpo cru (400 sem tocar no banco);
 *   3. grava em `WebhookEvent` com unique(provider, eventId) — repetido = 200
 *      sem reprocessar;
 *   4. processa dentro de transação, escopado por tenant;
 *   5. nunca confia no payload sem confrontar com o `PlatformSub` local.
 *
 * DOIS MODOS, ESCOLHIDOS POR `BILLING_PROVIDER`, NUNCA OS DOIS AO MESMO TEMPO:
 *
 *   - `mock`: autentica pelo token HMAC simples no header `stripe-signature`,
 *     que o `MockBillingProvider` envia. É o comportamento da F7.2.
 *   - `stripe`: exige a assinatura nativa do Stripe (`t=...,v1=...`), verificada
 *     por `constructEvent` com tolerância de timestamp. O token do mock NÃO é
 *     aceito neste modo — aceitar os dois viraria bypass da assinatura.
 *
 * Toda a persistência vive em `./processor`; aqui só há HTTP.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  let mode: 'mock' | 'stripe';
  try {
    mode = billingAuthMode();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ received: false, error: message }, { status: 500 });
  }

  return mode === 'stripe'
    ? handleStripeWebhook(request, rawBody)
    : handleMockWebhook(request, rawBody);
}

/** Modo de autenticação. Config inválida falha fechado, não cai no mock. */
function billingAuthMode(): 'mock' | 'stripe' {
  const provider = process.env.BILLING_PROVIDER ?? 'mock';
  if (provider === 'mock' || provider === 'stripe') {
    return provider;
  }
  throw new Error(
    `BILLING_PROVIDER inválido: ${JSON.stringify(provider)}. Use "mock" ou "stripe".`,
  );
}

/** Modo mock: token HMAC simples, como o `MockBillingProvider` assina. */
async function handleMockWebhook(request: Request, rawBody: string): Promise<Response> {
  let secret: string;
  try {
    secret = getBillingWebhookSecret();
  } catch (error) {
    // Sem segredo em produção, responder 401 faria o provedor reentregar para
    // sempre uma credencial que não existe: é erro de servidor, não assinatura
    // inválida.
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ received: false, error: message }, { status: 500 });
  }

  const signature = request.headers.get(BILLING_WEBHOOK_TOKEN_HEADER) ?? undefined;
  if (!verifyBillingWebhookSignature(rawBody, signature, secret)) {
    return Response.json({ received: false, error: 'assinatura inválida' }, { status: 401 });
  }

  const event = parseBillingWebhookEvent(rawBody);
  if (!event) {
    return Response.json({ received: false, error: 'payload inválido' }, { status: 400 });
  }

  return processEvent(event, rawBody);
}

/**
 * Modo Stripe: assinatura HMAC nativa. Qualquer falha de verificação — header
 * ausente, assinatura que não bate, timestamp fora da tolerância (replay) —
 * vira 400 sem chegar ao banco.
 */
async function handleStripeWebhook(request: Request, rawBody: string): Promise<Response> {
  let secret: string;
  try {
    secret = getStripeWebhookSecret();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ received: false, error: message }, { status: 500 });
  }

  const signature = request.headers.get(BILLING_WEBHOOK_TOKEN_HEADER);
  let stripeEvent;
  try {
    stripeEvent = constructStripeWebhookEvent(rawBody, signature, secret);
  } catch {
    return Response.json({ received: false, error: 'assinatura inválida' }, { status: 400 });
  }

  let event: BillingWebhookEvent | null;
  try {
    event = await translateStripeEvent(stripeEvent);
  } catch (error) {
    if (error instanceof StripeWebhookConfigError) {
      return Response.json({ received: false, error: error.message }, { status: 500 });
    }
    const message =
      error instanceof StripeWebhookTranslationError ? error.message : 'evento inválido';
    return Response.json({ received: false, error: message }, { status: 400 });
  }

  // Tipo que não mapeia para nenhum evento do produto: 200 e ignora. O Stripe
  // manda dezenas de tipos e reentrega o que responde erro.
  if (!event) {
    return Response.json({ received: true, ignored: true }, { status: 200 });
  }

  return processEvent(event, rawBody);
}

/** Persistência e tradução de erro comuns aos dois modos. */
async function processEvent(event: BillingWebhookEvent, rawBody: string): Promise<Response> {
  try {
    const result = await processBillingWebhook(event, rawBody);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof WebhookProcessingError) {
      return Response.json(
        { received: false, error: error.message },
        { status: error.status },
      );
    }
    console.error('[webhook:billing] falha ao processar evento', {
      eventId: event.eventId,
      type: event.type,
    });
    return Response.json({ received: false, error: 'erro interno' }, { status: 500 });
  }
}
