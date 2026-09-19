import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CheckoutFlow } from '@/app/[slug]/(portal)/checkout/_components/CheckoutFlow';
import type { CheckoutQuote } from '@/lib/payments/charge';

vi.mock('@/app/[slug]/(portal)/checkout/actions', () => ({
  startCheckoutAction: vi.fn(),
  confirmWithCreditAction: vi.fn(),
}));

/**
 * A tela do checkout diante de um assinante com crédito.
 *
 * O que se prova aqui é uma AUSÊNCIA: quando o clube cobre o serviço, a tela
 * não pode oferecer Pix nem cartão. Oferecer convidaria o assinante a pagar de
 * novo por algo que a mensalidade dele já paga — o servidor recusaria
 * (`startCheckout` tem o portão), mas o cliente veria um erro em vez do
 * caminho certo.
 */

function quoteWith(credit: CheckoutQuote['credit']): CheckoutQuote {
  return {
    holdId: 'hold_1',
    serviceId: 'svc_1',
    serviceName: 'Corte',
    staffName: 'Carlos',
    durationMin: 30,
    startsAt: '2027-03-01T12:00:00.000Z',
    holdExpiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    timezone: 'America/Sao_Paulo',
    paymentMode: 'FULL_PREPAID',
    effectiveMode: 'FULL_PREPAID',
    degraded: false,
    priceCents: 5000,
    chargeAmountCents: 5000,
    platformFeeCents: 500,
    depositCents: null,
    depositPercent: null,
    credit,
  };
}

describe('checkout de quem tem crédito do clube', () => {
  it('oferece confirmar com o crédito, e não forma de pagamento', () => {
    render(<CheckoutFlow quote={quoteWith({ covered: true, balance: 2, requiresDeposit: false })} />);

    expect(screen.getByRole('button', { name: /confirmar com meu crédito/i })).toBeTruthy();
    expect(screen.getByText(/2 créditos/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^pix$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cart[ãa]o/i })).toBeNull();
  });

  it('sem crédito, a tela segue sendo a de pagamento', () => {
    render(
      <CheckoutFlow quote={quoteWith({ covered: false, balance: 0, requiresDeposit: false })} />,
    );

    expect(screen.queryByRole('button', { name: /confirmar com meu crédito/i })).toBeNull();
  });

  it('com sinal exigido pelo tenant, o assinante volta ao pagamento', () => {
    // A flag `membershipRequiresDeposit` é a pendência de produto isolada: com
    // ela ligada, o crédito cobre o serviço mas o sinal ainda é cobrado.
    render(
      <CheckoutFlow quote={quoteWith({ covered: true, balance: 2, requiresDeposit: true })} />,
    );

    expect(screen.queryByRole('button', { name: /confirmar com meu crédito/i })).toBeNull();
  });
});
