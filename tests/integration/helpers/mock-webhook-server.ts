import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { MockPaymentStore } from '@/lib/payments/mock-store';
import { handlePaymentWebhook } from '@/lib/payments/webhook';

export interface ReceivedWebhook {
  headers: Record<string, string | undefined>;
  body: string;
}

export interface MockWebhookServer {
  url: string;
  requests: ReceivedWebhook[];
  close(): Promise<void>;
}

function toWebhookHeaders(headers: IncomingHttpHeaders): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return result;
}

/**
 * Sobe um servidor HTTP local que faz o papel da rota real: recebe o POST,
 * passa pelo MESMO `handlePaymentWebhook` e responde. É assim que o teste de
 * integração prova que o mock faz uma requisição de verdade.
 */
export async function startMockWebhookServer(
  store: MockPaymentStore,
  options: { failWith?: number } = {},
): Promise<MockWebhookServer> {
  const requests: ReceivedWebhook[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({ headers: toWebhookHeaders(request.headers), body });

      if (options.failWith) {
        response.statusCode = options.failWith;
        response.end('erro simulado');
        return;
      }

      void handlePaymentWebhook(
        { rawBody: body, headers: toWebhookHeaders(request.headers) },
        store,
      ).then((result) => {
        response.statusCode = result.status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result.body));
      });
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Servidor de webhook de teste não conseguiu abrir porta.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/api/webhooks/payments`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
