import { getMockPaymentProvider } from '@/lib/payments';
import {
  errorMessage,
  guardDevAction,
  redirectToPaymentsConsole,
} from '../../_shared';

/**
 * Simula o Asaas confirmando a cobrança. O estado do lado da aplicação só muda
 * quando o webhook disparado aqui chega em /api/webhooks/payments.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const chargeId = String(form.get('chargeId') ?? '');

  try {
    const result = await getMockPaymentProvider().simulateChargePaid(chargeId);
    return redirectToPaymentsConsole({
      event: 'CHARGE_PAID',
      delivered: String(result.delivered),
    });
  } catch (error) {
    return redirectToPaymentsConsole({ error: errorMessage(error) });
  }
}
