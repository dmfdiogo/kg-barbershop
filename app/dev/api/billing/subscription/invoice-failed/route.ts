import { getMockBillingProvider } from '@/lib/billing';
import { errorMessage, guardDevAction, redirectToBillingConsole } from '../../_shared';

/** Simula a falha de cobrança; `PAST_DUE` só chega à aplicação por webhook. */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const subscriptionId = String(form.get('subscriptionId') ?? '');

  try {
    const result = await getMockBillingProvider().simulateInvoicePaymentFailed(subscriptionId);
    return redirectToBillingConsole({
      evento: 'INVOICE_PAYMENT_FAILED',
      entregue: String(result.delivered),
    });
  } catch (error) {
    return redirectToBillingConsole({ error: errorMessage(error) });
  }
}
