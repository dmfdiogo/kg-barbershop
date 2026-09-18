import { getMockPaymentProvider } from '@/lib/payments';
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

  try {
    const result = await getMockPaymentProvider().simulatePixExpired(chargeId);
    return redirectToPaymentsConsole({
      event: 'CHARGE_EXPIRED',
      delivered: String(result.delivered),
    });
  } catch (error) {
    return redirectToPaymentsConsole({ error: errorMessage(error) });
  }
}
