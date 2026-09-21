import { OTP_TEMPLATE, TEMPLATES, isTemplateName, type TemplateName } from './templates';
import {
  MessagingProviderError,
  OTP_CODE_PATTERN,
  isE164,
  type E164,
  type WhatsAppProvider,
} from './types';

/**
 * Adaptador real do `WhatsAppProvider` contra a Cloud API do Meta (F8.3).
 *
 * A ORDEM DAS VARIÁVEIS É O CONTRATO, e é o ponto mais perigoso deste arquivo.
 * O catálogo em `./templates.ts` nomeia (`customer_name`, `service_name`); o
 * WhatsApp numera por POSIÇÃO (`{{1}}`, `{{2}}`), sem nome nenhum no payload.
 * A posição N de `variables` vira `{{N+1}}`. Trocar duas de lugar entrega ao
 * cliente o nome do profissional onde deveria estar o serviço — e nada quebra,
 * porque as duas são texto. Por isso a validação abaixo é estrita nos dois
 * sentidos: variável faltando E variável a mais são erro, antes da rede.
 *
 * NENHUM CÓDIGO DE PRODUTO IMPORTA ESTE ARQUIVO — só a factory de `./index.ts`,
 * escolhida por `MESSAGING_PROVIDER`.
 *
 * O TEMPLATE DE OTP AINDA NÃO EXISTE NA CONTA. Templates de categoria
 * AUTHENTICATION exigem verificação do negócio na Meta, que depende de CNPJ.
 * O envio está implementado no formato que a Cloud API espera — corpo com o
 * código e botão de copiar —, mas nunca foi exercitado contra a conta real.
 * Quando a verificação sair, é o primeiro caminho a testar de ponta a ponta.
 */

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';
const LANGUAGE = 'pt_BR';

export interface WhatsAppCloudOptions {
  accessToken?: string;
  phoneNumberId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface GraphError {
  message?: string;
  error_user_title?: string;
  error_user_msg?: string;
  code?: number;
}

/**
 * O `to` da Cloud API vai SEM o `+`. Mandar com o sinal faz o Meta responder
 * que o número é inválido, sem dizer o porquê.
 */
function toRecipient(phone: E164): string {
  return phone.replace(/^\+/, '');
}

/**
 * Converte o mapa nomeado do produto na lista posicional do WhatsApp,
 * validando nos dois sentidos antes de chegar perto da rede.
 */
export function toPositionalParameters(
  template: TemplateName,
  vars: Record<string, string>,
): string[] {
  const definition = TEMPLATES[template];
  const expected = definition.variables;

  for (const name of expected) {
    const value = vars[name];
    if (value === undefined || value === '') {
      throw new MessagingProviderError(
        'MISSING_TEMPLATE_VARIABLE',
        `Template ${template} exige a variável ${name}.`,
      );
    }
  }
  for (const name of Object.keys(vars)) {
    if (!(expected as readonly string[]).includes(name)) {
      throw new MessagingProviderError(
        'UNKNOWN_TEMPLATE_VARIABLE',
        `Template ${template} não tem a variável ${name}.`,
      );
    }
  }

  // A ordem vem do catálogo, nunca de `Object.keys(vars)` — a ordem de um
  // objeto é a de inserção de quem montou o mapa, e o WhatsApp lê por posição.
  return expected.map((name) => vars[name]!);
}

export class WhatsAppCloudProvider implements WhatsAppProvider {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: WhatsAppCloudOptions = {}) {
    const token = options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = options.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw new Error(
        'WHATSAPP_ACCESS_TOKEN e WHATSAPP_PHONE_NUMBER_ID são obrigatórios para MESSAGING_PROVIDER=whatsapp.',
      );
    }
    this.token = token.trim();
    this.phoneNumberId = phoneNumberId.trim();
    this.baseUrl = (options.baseUrl ?? GRAPH_BASE).replace(/\/$/, '');
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private async send(body: unknown): Promise<{ providerMessageId: string }> {
    const response = await this.doFetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const error = (data.error ?? {}) as GraphError;
      // O produto não ramifica por mensagem de fornecedor: tudo que o Meta
      // recusa por forma do payload vira VALIDATION, e o texto dele fica só
      // como explicação.
      throw new MessagingProviderError(
        'UNKNOWN_TEMPLATE',
        error.error_user_msg ?? error.error_user_title ?? error.message ?? 'Envio recusado.',
      );
    }

    const id = ((data.messages as { id?: string }[]) ?? [])[0]?.id;
    if (!id) {
      throw new MessagingProviderError('UNKNOWN_TEMPLATE', 'Meta não devolveu id da mensagem.');
    }
    return { providerMessageId: id };
  }

  async sendOtp(to: E164, code: string): Promise<{ providerMessageId: string }> {
    if (!isE164(to)) {
      throw new MessagingProviderError('INVALID_PHONE', `Telefone fora do padrão E.164: ${to}`);
    }
    if (!OTP_CODE_PATTERN.test(code)) {
      throw new MessagingProviderError('INVALID_OTP_CODE', 'Código OTP precisa ter 6 dígitos.');
    }

    // Template de autenticação: o Meta monta o texto, nós mandamos o código
    // duas vezes — no corpo e no botão de copiar, que é como a Cloud API
    // espera. Ainda não exercitado contra a conta real (ver o topo).
    return this.send({
      messaging_product: 'whatsapp',
      to: toRecipient(to),
      type: 'template',
      template: {
        name: OTP_TEMPLATE,
        language: { code: LANGUAGE },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    });
  }

  async sendTemplate(
    to: E164,
    template: TemplateName,
    vars: Record<string, string>,
  ): Promise<{ providerMessageId: string }> {
    if (!isE164(to)) {
      throw new MessagingProviderError('INVALID_PHONE', `Telefone fora do padrão E.164: ${to}`);
    }
    if (!isTemplateName(template)) {
      throw new MessagingProviderError(
        'UNKNOWN_TEMPLATE',
        `Template desconhecido: ${String(template)}`,
      );
    }

    const parameters = toPositionalParameters(template, vars);

    return this.send({
      messaging_product: 'whatsapp',
      to: toRecipient(to),
      type: 'template',
      template: {
        name: TEMPLATES[template].name,
        language: { code: LANGUAGE },
        ...(parameters.length > 0
          ? {
              components: [
                {
                  type: 'body',
                  parameters: parameters.map((text) => ({ type: 'text', text })),
                },
              ],
            }
          : {}),
      },
    });
  }
}

let cached: WhatsAppCloudProvider | null = null;

export function getWhatsAppCloudProvider(): WhatsAppCloudProvider {
  cached ??= new WhatsAppCloudProvider();
  return cached;
}

/** Só para teste: descarta o cliente memoizado. */
export function resetWhatsAppCloudProvider(): void {
  cached = null;
}
