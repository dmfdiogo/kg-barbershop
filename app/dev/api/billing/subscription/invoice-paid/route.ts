import { getMockBillingProvider } from '@/lib/billing';
import { errorMessage, guardDevAction, redirectToBillingConsole } from '../../_shared';

/** Simula a fatura paga no provedor; o `PlatformSub` muda via webhook. */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const subscriptionId = String(form.get('subscriptionId') ?? '');

  try {
    const result = await getMockBillingProvider().simulateInvoicePaid(subscriptionId);
    return redirectToBillingConsole({
      evento: 'INVOICE_PAID',
      entregue: String(result.delivered),
    });
  } catch (error) {
    return redirectToBillingConsole({ error: errorMessage(error) });
  }
}
