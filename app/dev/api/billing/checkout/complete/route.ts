import { getMockBillingProvider } from '@/lib/billing';
import { errorMessage, guardDevAction, redirectToBillingConsole } from '../../_shared';

/**
 * "Concluir pagamento" da sessão hospedada — o que o dono faria na página do
 * provedor. É aqui que a assinatura nasce no mock e o `SUBSCRIPTION_CREATED`
 * sai de verdade contra `/api/webhooks/billing`; o `PlatformSub` só muda quando
 * o webhook chega.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const sessionId = String(form.get('sessionId') ?? '');

  try {
    const { delivery } = await getMockBillingProvider().completeCheckoutSession(sessionId);
    return redirectToBillingConsole({
      sessao: sessionId,
      evento: 'SUBSCRIPTION_CREATED',
      entregue: String(delivery.delivered),
    });
  } catch (error) {
    return redirectToBillingConsole({ sessao: sessionId, error: errorMessage(error) });
  }
}
