import { describe, expect, it, vi } from 'vitest';
import { MessagingProviderError } from '@/lib/messaging/types';
import { TEMPLATES } from '@/lib/messaging/templates';
import { WhatsAppCloudProvider, toPositionalParameters } from '@/lib/messaging/whatsapp';

/**
 * O adaptador da Cloud API, com `fetch` injetado — nenhum teste toca a rede.
 *
 * O que estes testes protegem, acima de tudo, é a TRADUÇÃO POSICIONAL. O
 * catálogo nomeia as variáveis; o WhatsApp numera por posição e não manda
 * nome nenhum no payload. Se a ordem escorregar, o cliente recebe o nome do
 * profissional no lugar do serviço e nada quebra — as duas são texto, o Meta
 * aceita, a mensagem sai errada. Só um teste pega isso.
 */

/** Forma mínima do payload que o Meta recebe, para os asserts não usarem `any`. */
interface TemplatePayload {
  to: string;
  template: {
    name: string;
    language: { code: string };
    components?: { type: string; parameters: { type: string; text: string }[] }[];
  };
}

function fakeFetch(captured: { body?: unknown }, response: unknown = { messages: [{ id: 'wamid.X' }] }, ok = true) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    captured.body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(response), { status: ok ? 200 : 400 });
  }) as unknown as typeof fetch;
}

function provider(fetchImpl: typeof fetch) {
  return new WhatsAppCloudProvider({
    accessToken: 'tok_teste',
    phoneNumberId: '123456',
    fetchImpl,
  });
}

describe('tradução das variáveis nomeadas para posicionais', () => {
  it('respeita a ordem do catálogo, não a ordem do objeto', () => {
    // O mapa é montado FORA de ordem de propósito: quem chama não deve
    // precisar saber a ordem, e `Object.keys` devolve ordem de inserção.
    const vars = {
      new_starts_at: 'sábado, 13/06 às 10:00',
      customer_name: 'Ana',
      old_starts_at: 'sexta, 12/06 às 14:00',
      service_name: 'Corte masculino',
    };
    const posicional = toPositionalParameters('booking_rescheduled_customer', vars);

    expect(TEMPLATES.booking_rescheduled_customer.variables).toEqual([
      'customer_name',
      'service_name',
      'old_starts_at',
      'new_starts_at',
    ]);
    expect(posicional).toEqual([
      'Ana',
      'Corte masculino',
      'sexta, 12/06 às 14:00',
      'sábado, 13/06 às 10:00',
    ]);
  });

  it('recusa variável faltando', () => {
    expect(() => toPositionalParameters('booking_reminder_h2', { customer_name: 'Ana' })).toThrow(
      MessagingProviderError,
    );
  });

  it('recusa variável a mais, em vez de ignorar em silêncio', () => {
    // Variável sobrando quase sempre significa que quem chamou acha que o
    // template diz uma coisa que ele não diz.
    expect(() =>
      toPositionalParameters('booking_reminder_h2', {
        customer_name: 'Ana',
        starts_at: '14:00',
        inventada: 'x',
      }),
    ).toThrow(MessagingProviderError);
  });
});

describe('WhatsAppCloudProvider', () => {
  it('envia o template com os parâmetros na ordem e sem o + no destinatário', async () => {
    const captured: { body?: unknown } = {};
    const p = provider(fakeFetch(captured));

    const r = await p.sendTemplate('+554890000100', 'booking_reminder_h2', {
      customer_name: 'Ana',
      starts_at: '14:00',
    });

    expect(r.providerMessageId).toBe('wamid.X');
    const body = captured.body as TemplatePayload;
    // A Cloud API recusa o destinatário com `+`, e a mensagem de erro não diz
    // isso — devolve só "número inválido".
    expect(body.to).toBe('554890000100');
    expect(body.template.name).toBe('booking_reminder_h2');
    expect(body.template.language.code).toBe('pt_BR');
    expect(body.template.components?.[0]?.parameters).toEqual([
      { type: 'text', text: 'Ana' },
      { type: 'text', text: '14:00' },
    ]);
  });

  it('recusa telefone fora do E.164 antes de chamar a rede', async () => {
    const chamou = vi.fn();
    const p = provider(chamou as unknown as typeof fetch);

    await expect(
      p.sendTemplate('48999990000', 'booking_reminder_h2', {
        customer_name: 'Ana',
        starts_at: '14:00',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PHONE' });
    expect(chamou).not.toHaveBeenCalled();
  });

  it('recusa código OTP fora de 6 dígitos antes de chamar a rede', async () => {
    const chamou = vi.fn();
    const p = provider(chamou as unknown as typeof fetch);

    await expect(p.sendOtp('+554890000100', '123')).rejects.toMatchObject({
      code: 'INVALID_OTP_CODE',
    });
    expect(chamou).not.toHaveBeenCalled();
  });

  it('manda o código no corpo e no botão de copiar', async () => {
    const captured: { body?: unknown } = {};
    const p = provider(fakeFetch(captured));

    await p.sendOtp('+554890000100', '202389');

    const body = captured.body as TemplatePayload;
    expect(body.template.name).toBe('otp_login');
    expect(body.template.components?.[0]?.parameters[0]?.text).toBe('202389');
    expect(body.template.components?.[1]?.parameters[0]?.text).toBe('202389');
  });

  it('traduz a recusa do Meta sem vazar o formato do fornecedor', async () => {
    const captured: { body?: unknown } = {};
    const p = provider(
      fakeFetch(
        captured,
        { error: { error_user_msg: 'Modelo não aprovado.', code: 132001 } },
        false,
      ),
    );

    const erro = await p
      .sendTemplate('+554890000100', 'booking_reminder_h2', {
        customer_name: 'Ana',
        starts_at: '14:00',
      })
      .catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(MessagingProviderError);
    expect((erro as MessagingProviderError).message).toBe('Modelo não aprovado.');
  });
});
