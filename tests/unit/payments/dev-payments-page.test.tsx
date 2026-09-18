import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentsConsolePage from '@/app/dev/payments/page';
import { MockPaymentProvider, resetMockPaymentProvider } from '@/lib/payments/mock';
import { resetMockPaymentStore } from '@/lib/payments/mock-store';

describe('/dev/payments', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    resetMockPaymentStore();
    resetMockPaymentProvider();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mostra os botões do item 5.3 para uma cobrança Pix pendente', async () => {
    const provider = new MockPaymentProvider({
      transport: { deliver: async () => ({ ok: true, status: 200 }) },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: 'page-secret',
    });
    const account = await provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '12345678909',
    });
    await provider.simulateKycDecision(account.accountId, 'APPROVED');
    await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
    });

    const page = await PaymentsConsolePage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole('button', { name: 'Confirmar pagamento' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expirar Pix' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aprovar KYC' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reprovar KYC' })).toBeInTheDocument();
  });

  it('mostra o estorno quando a cobrança está paga', async () => {
    const provider = new MockPaymentProvider({
      transport: { deliver: async () => ({ ok: true, status: 200 }) },
      webhookUrl: 'http://127.0.0.1:9/api/webhooks/payments',
      webhookSecret: 'page-secret',
    });
    const account = await provider.createMerchantAccount({
      name: 'Barbearia Teste',
      document: '12345678909',
    });
    await provider.simulateKycDecision(account.accountId, 'APPROVED');
    const charge = await provider.createCharge({
      accountId: account.accountId,
      customerId: 'customer_1',
      method: 'PIX',
      amountCents: 5000,
      dueDate: '2030-01-15',
    });
    await provider.simulateChargePaid(charge.id);

    const page = await PaymentsConsolePage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole('button', { name: 'Estornar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmar pagamento' })).not.toBeInTheDocument();
  });

  it('não renderiza fora de desenvolvimento', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(
      PaymentsConsolePage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
  });
});
