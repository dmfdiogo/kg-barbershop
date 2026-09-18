import { getMockPaymentProvider, snapshotMockPaymentStore } from '@/lib/payments';
import {
  errorMessage,
  guardDevAction,
  redirectToPaymentsConsole,
} from '../../_shared';

export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const chargeId = String(form.get('chargeId') ?? '');
  const amountCents = Number(form.get('amountCents'));

  try {
    await getMockPaymentProvider().refund(chargeId, amountCents);
    // `refund` faz parte do port e devolve só o estorno; para o console, o
    // resultado da entrega é o registro mais recente do log do mock.
    const latestDelivery = snapshotMockPaymentStore().webhookDeliveries[0];
    return redirectToPaymentsConsole({
      event: latestDelivery?.type ?? 'CHARGE_REFUNDED',
      delivered: String(latestDelivery?.delivered ?? false),
    });
  } catch (error) {
    return redirectToPaymentsConsole({ error: errorMessage(error) });
  }
}
