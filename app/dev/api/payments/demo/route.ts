import { getMockPaymentProvider, snapshotMockPaymentStore } from '@/lib/payments';
import {
  errorMessage,
  guardDevAction,
  redirectToPaymentsConsole,
} from '../_shared';

/**
 * Semeia um cenário mínimo para o console ser útil sem depender das telas de
 * produto (que só existem a partir da F2/F3). Reprova tudo que o Asaas real
 * reprovaria — inclusive o KYC, que começa pendente e precisa da decisão.
 */
export async function POST(): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  try {
    const provider = getMockPaymentProvider();
    const snapshot = snapshotMockPaymentStore();

    let accountId = snapshot.merchants[0]?.accountId;
    if (!accountId) {
      const created = await provider.createMerchantAccount({
        name: 'Estabelecimento Demo',
        document: '12345678909',
        phone: '+5548999999999',
        pixKey: 'demo@exemplo.com.br',
      });
      accountId = created.accountId;
    }

    const merchant = await provider.getMerchantAccount(accountId);
    if (merchant.kycStatus !== 'APPROVED') {
      await provider.simulateKycDecision(accountId, 'APPROVED');
    }

    const hasCharges = snapshot.charges.some((charge) => charge.accountId === accountId);
    if (!hasCharges) {
      const customerId = 'customer_demo';
      const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await provider.createCharge({
        accountId,
        customerId,
        method: 'PIX',
        amountCents: 5000,
        dueDate,
        description: 'Corte demo (Pix)',
      });
      const { token } = await provider.tokenizeCard({
        accountId,
        customerId,
        number: '4111111111111111',
        holderName: 'Cliente Demo',
        expiryMonth: '12',
        expiryYear: '2030',
        ccv: '123',
        remoteIp: '8.8.8.8',
      });
      await provider.createCharge({
        accountId,
        customerId,
        method: 'CARD',
        amountCents: 8000,
        dueDate,
        description: 'Barba demo (cartão)',
        cardToken: token,
        remoteIp: '8.8.8.8',
      });
    }

    return redirectToPaymentsConsole({ event: 'DEMO_READY', delivered: 'true' });
  } catch (error) {
    return redirectToPaymentsConsole({ error: errorMessage(error) });
  }
}
