// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MockWhatsAppProvider } from '@/lib/messaging/mock';
import { clearOutboxMessages, listOutboxMessages } from '@/lib/messaging/outbox';
import { TEMPLATES } from '@/lib/messaging/templates';
import {
  MessagingProviderError,
  type WhatsAppProvider,
} from '@/lib/messaging/types';

/**
 * Suíte de contrato do WhatsAppProvider (contexto-comum.md §5.4).
 * Na F8.3 o adaptador da Cloud API entra na mesma lista.
 */
interface MessagingFixture {
  name: string;
  create(): WhatsAppProvider;
}

const fixtures: MessagingFixture[] = [
  { name: 'MockWhatsAppProvider', create: () => new MockWhatsAppProvider() },
];

async function captureError(promise: Promise<unknown>): Promise<MessagingProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MessagingProviderError) {
      return error;
    }
    throw error;
  }
  throw new Error('Esperava erro do provider, mas a chamada resolveu.');
}

function variablesFor(template: keyof typeof TEMPLATES): Record<string, string> {
  return Object.fromEntries(TEMPLATES[template].variables.map((name) => [name, 'valor']));
}

describe.each(fixtures)('WhatsAppProvider: $name', (fixture) => {
  let provider!: WhatsAppProvider;

  beforeEach(() => {
    provider = fixture.create();
    clearOutboxMessages();
  });

  it('envia OTP para telefone em E.164', async () => {
    const result = await provider.sendOtp('+5548999999999', '123456');
    expect(result.providerMessageId).not.toHaveLength(0);
  });

  it('recusa número fora de E.164', async () => {
    for (const phone of ['5548999999999', '+55 48 99999-9999', 'abc', '']) {
      const error = await captureError(provider.sendOtp(phone, '123456'));
      expect(error.code).toBe('INVALID_PHONE');

      const templateError = await captureError(
        provider.sendTemplate(phone, 'booking_reminder_h2', {
          customer_name: 'Ana',
          starts_at: '2030-01-15T10:00:00Z',
        }),
      );
      expect(templateError.code).toBe('INVALID_PHONE');
    }
  });

  it('recusa código OTP que não tem 6 dígitos', async () => {
    const error = await captureError(provider.sendOtp('+5548999999999', '12345'));
    expect(error.code).toBe('INVALID_OTP_CODE');
  });

  it('envia template registrado com todas as variáveis', async () => {
    const result = await provider.sendTemplate(
      '+5548999999999',
      'booking_confirmation',
      variablesFor('booking_confirmation'),
    );
    expect(result.providerMessageId).not.toHaveLength(0);
  });

  it('recusa template não registrado', async () => {
    const error = await captureError(
      provider.sendTemplate(
        '+5548999999999',
        'template_inventado' as never,
        { qualquer: 'coisa' },
      ),
    );
    expect(error.code).toBe('UNKNOWN_TEMPLATE');
  });

  it('recusa variável obrigatória ausente', async () => {
    const error = await captureError(
      provider.sendTemplate('+5548999999999', 'booking_confirmation', {
        customer_name: 'Ana',
      }),
    );
    expect(error.code).toBe('MISSING_TEMPLATE_VARIABLE');
  });

  it('recusa variável não declarada no template', async () => {
    const error = await captureError(
      provider.sendTemplate('+5548999999999', 'booking_reminder_h2', {
        ...variablesFor('booking_reminder_h2'),
        extra: 'não existe',
      }),
    );
    expect(error.code).toBe('UNKNOWN_TEMPLATE_VARIABLE');
  });
});

describe('MockWhatsAppProvider: outbox lido por /dev/outbox', () => {
  let provider!: MockWhatsAppProvider;

  beforeEach(() => {
    provider = new MockWhatsAppProvider();
    clearOutboxMessages();
  });

  it('registra o OTP com o código visível', async () => {
    await provider.sendOtp('+5548999999999', '654321');

    const messages = listOutboxMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.to).toBe('+5548999999999');
    expect(messages[0]?.kind).toBe('otp');
    expect(messages[0]?.code).toBe('654321');
  });

  it('registra template com as variáveis enviadas', async () => {
    await provider.sendTemplate('+5548999999999', 'booking_reminder_h2', {
      customer_name: 'Ana',
      starts_at: '2030-01-15T10:00:00Z',
    });

    const messages = listOutboxMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]?.template).toBe('booking_reminder_h2');
    expect(messages[0]?.vars).toEqual({
      customer_name: 'Ana',
      starts_at: '2030-01-15T10:00:00Z',
    });
  });
});

describe('registro de templates', () => {
  it('tem nome igual à chave e variáveis sem repetição', () => {
    for (const [key, definition] of Object.entries(TEMPLATES)) {
      expect(definition.name).toBe(key);
      expect(new Set(definition.variables).size).toBe(definition.variables.length);
    }
  });
});
