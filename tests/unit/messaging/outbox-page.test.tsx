import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OutboxPage from '@/app/dev/outbox/page';
import { MockWhatsAppProvider } from '@/lib/messaging/mock';
import { clearOutboxMessages } from '@/lib/messaging/outbox';

describe('/dev/outbox', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'development');
    clearOutboxMessages();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('mostra o código OTP enviado pelo mock', async () => {
    await new MockWhatsAppProvider().sendOtp('+5548999999999', '135790');

    render(<OutboxPage />);

    expect(screen.getByText('135790')).toBeInTheDocument();
    expect(screen.getByText(/\+5548999999999/)).toBeInTheDocument();
    expect(screen.getByText('otp_login')).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há mensagens', () => {
    render(<OutboxPage />);
    expect(screen.getByText(/Nenhuma mensagem enviada ainda/)).toBeInTheDocument();
  });

  it('não renderiza fora de desenvolvimento', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => OutboxPage()).toThrow();
  });
});
