import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BillingConsolePage from '@/app/dev/billing/page';
import {
  loadBillingConsoleData,
  type BillingConsoleData,
} from '@/app/dev/billing/_data';

vi.mock('@/app/dev/billing/_data', () => ({
  loadBillingConsoleData: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockedLoad = vi.mocked(loadBillingConsoleData);

const DATA: BillingConsoleData = {
  tenants: [
    {
      id: 'tenant_a',
      name: 'Carlos Barber',
      slug: 'carlosbarber',
      status: 'ACTIVE',
      appPlan: 'EQUIPE',
      appStatus: 'ACTIVE',
      appCurrentPeriodEnd: '2026-02-01T00:00:00.000Z',
      canStartCheckout: false,
    },
  ],
  customers: [{ id: 'cus_billing_mock_1', tenantId: 'tenant_a', name: 'Carlos Barber' }],
  sessions: [
    {
      id: 'cs_billing_mock_1',
      customerId: 'cus_billing_mock_1',
      customerName: 'Carlos Barber',
      tenantId: 'tenant_a',
      plan: 'EQUIPE',
      planName: 'Equipe',
      priceCents: 7990,
      status: 'PENDING',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  subscriptions: [
    {
      id: 'sub_billing_mock_1',
      customerId: 'cus_billing_mock_1',
      customerName: 'Carlos Barber',
      tenantId: 'tenant_a',
      plan: 'EQUIPE',
      planName: 'Equipe',
      amountCents: 7990,
      status: 'ACTIVE',
      currentPeriodEnd: '2026-02-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      appStatus: 'ACTIVE',
      appPlan: 'EQUIPE',
    },
  ],
  deliveries: [
    {
      id: 'delivery_1',
      eventId: 'evt_1',
      type: 'SUBSCRIPTION_CREATED',
      url: 'http://localhost/api/webhooks/billing',
      delivered: true,
      httpStatus: 200,
      at: '2026-01-01T00:00:00.000Z',
    },
  ],
};

describe('/dev/billing', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    mockedLoad.mockResolvedValue(DATA);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('mostra a sessão pendente destacada e o botão de concluir', async () => {
    const page = await BillingConsolePage({
      searchParams: Promise.resolve({ sessao: 'cs_billing_mock_1' }),
    });
    render(page);

    expect(screen.getByRole('button', { name: 'Concluir pagamento' })).toBeInTheDocument();
    expect(screen.getByText('sessão da URL')).toBeInTheDocument();
    expect(screen.getAllByText(/Equipe/).length).toBeGreaterThan(0);
  });

  it('mostra os controles de simulação das assinaturas', async () => {
    const page = await BillingConsolePage({ searchParams: Promise.resolve({}) });
    render(page);

    expect(screen.getByRole('button', { name: 'Marcar fatura paga' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Simular falha de pagamento' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('não renderiza fora de desenvolvimento', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(
      BillingConsolePage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow();
  });
});
