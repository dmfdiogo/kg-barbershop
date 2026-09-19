import { getMockBillingProvider, getMockBillingStore } from '@/lib/billing';
import { errorMessage, guardDevAction, redirectToBillingConsole } from '../../_shared';

/**
 * Cancela a assinatura no provedor. Cancelamento imediato — o estado local só
 * vira CANCELED quando o `SUBSCRIPTION_CANCELED` chega por webhook.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const subscriptionId = String(form.get('subscriptionId') ?? '');

  try {
    await getMockBillingProvider().cancelSubscription(subscriptionId, false);
    const delivery = getMockBillingStore().webhookDeliveries[0];
    return redirectToBillingConsole({
      evento: 'SUBSCRIPTION_CANCELED',
      entregue: String(delivery?.delivered ?? false),
    });
  } catch (error) {
    return redirectToBillingConsole({ error: errorMessage(error) });
  }
}
