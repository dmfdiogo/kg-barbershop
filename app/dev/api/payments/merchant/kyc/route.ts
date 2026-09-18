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
  const accountId = String(form.get('accountId') ?? '');
  const decision = String(form.get('decision') ?? '');

  if (decision !== 'APPROVED' && decision !== 'REJECTED') {
    return redirectToPaymentsConsole({ error: `Decisão de KYC inválida: ${decision}` });
  }

  try {
    const result = await getMockPaymentProvider().simulateKycDecision(accountId, decision);
    return redirectToPaymentsConsole({
      event: `MERCHANT_KYC_UPDATED:${decision}`,
      delivered: String(result.delivered),
    });
  } catch (error) {
    return redirectToPaymentsConsole({ error: errorMessage(error) });
  }
}
