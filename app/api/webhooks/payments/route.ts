import {
  parsePaymentWebhookEvent,
  verifyPaymentWebhookToken,
} from '@/lib/payments/webhook';
import { processPaymentWebhook, WebhookProcessingError } from './processor';

/**
 * Webhook de pagamentos B2C — rota de domínio, nomeada pelo negócio e não pelo
 * provider (é a URL que se cola no painel do Asaas na F8.2).
 *
 * ASSUMIDA PELA F4.0. A F0.3 deixou a versão mínima (só token + handler em
 * memória, sem banco). Esta versão entrega o núcleo real, na ordem exigida por
 * `contexto-comum.md` §6:
 *
 *   1. verifica assinatura/token ANTES de qualquer coisa;
 *   2. grava em `WebhookEvent` com unique(provider, eventId) — repetido = 200
 *      sem reprocessar;
 *   3. processa dentro de transação, escopado por tenant;
 *   4. confronta o valor do payload com o `Payment` local (payload é entrada
 *      não confiável).
 *
 * Toda a persistência vive em `./processor`; aqui só há HTTP.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();

  const auth = verifyPaymentWebhookToken(request.headers);
  if (!auth.ok) {
    return Response.json({ received: false, error: auth.error }, { status: auth.status });
  }

  const event = parsePaymentWebhookEvent(rawBody);
  if (!event) {
    return Response.json({ received: false, error: 'payload inválido' }, { status: 400 });
  }

  try {
    const result = await processPaymentWebhook(event, rawBody);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    if (error instanceof WebhookProcessingError) {
      return Response.json(
        { received: false, error: error.message },
        { status: error.status },
      );
    }
    console.error('[webhook:payments] falha ao processar evento', {
      eventId: event.eventId,
      type: event.type,
    });
    return Response.json({ received: false, error: 'erro interno' }, { status: 500 });
  }
}
