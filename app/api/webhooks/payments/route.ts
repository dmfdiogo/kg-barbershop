import { handlePaymentWebhook } from '@/lib/payments/webhook';

/**
 * Webhook de pagamentos B2C — versão mínima criada pela F0.3.
 *
 * POR QUE MÍNIMA: a F0.2 (schema/Prisma) estava rodando em paralelo e ainda não
 * tinha sido mesclada, então aqui NÃO existe banco: assinatura/token são
 * verificados de verdade e a idempotência (dedupe por `provider:eventId`) vive
 * no store do MockPaymentProvider. A rota só despacha para o handler
 * (`lib/payments/webhook.ts`), sem persistência de domínio.
 *
 * REPASSE PARA A F4.0: você assume a propriedade deste arquivo e desta rota.
 * Substitua o handler pelo núcleo real: persistência em `WebhookEvent` com
 * `unique(provider, eventId)`, processamento transacional e a máquina de
 * estados `Booking` × `Payment`. O caminho `/api/webhooks/payments` NÃO muda —
 * ele é nomeado pelo domínio, não pelo provider (Asaas na F8.2), e é a URL que
 * se cola no painel do Asaas.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const result = await handlePaymentWebhook({ rawBody, headers: request.headers });
  return Response.json(result.body, { status: result.status });
}
