import {
  BILLING_WEBHOOK_TOKEN_HEADER,
  getBillingWebhookSecret,
  verifyBillingWebhookSignature,
} from '@/lib/billing/webhook';
import {
  parseBillingWebhookEvent,
  processBillingWebhook,
  WebhookProcessingError,
} from './processor';

/**
 * Webhook de billing B2B — rota de domínio, nomeada pelo negócio e não pelo
 * provider (é a URL que se cadastra no Stripe na F8.1).
 *
 * ASSUMIDA PELA F7.2. Segue, na ordem, o contrato de `contexto-comum.md` §6:
 *
 *   1. verifica a assinatura HMAC ANTES de qualquer coisa;
 *   2. parse do corpo cru (400 sem tocar no banco);
 *   3. grava em `WebhookEvent` com unique(provider, eventId) — repetido = 200
 *      sem reprocessar;
 *   4. processa dentro de transação, escopado por tenant;
 *   5. nunca confia no payload sem confrontar com o `PlatformSub` local.
 *
 * Toda a persistência vive em `./processor`; aqui só há HTTP.
 *
 * A assinatura é HMAC-SHA256 no header `stripe-signature`, exatamente o
 * mecanismo do Stripe. O mock assina o mesmo corpo que a F8.1 vai assinar, e é
 * por isso que trocar o provedor não muda esta rota.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

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
