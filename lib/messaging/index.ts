import { getMockWhatsAppProvider, MockWhatsAppProvider } from './mock';
import type { WhatsAppProvider } from './types';

export * from './templates';
export * from './types';

/**
 * Factory do port de mensageria (`fases/contexto-comum.md` §5).
 * Nenhum código de produto importa o adaptador diretamente — só esta factory.
 */
export function getWhatsAppProvider(): WhatsAppProvider {
  const provider = process.env.MESSAGING_PROVIDER ?? 'mock';

  switch (provider) {
    case 'mock':
      return getMockWhatsAppProvider();
    case 'cloud-api':
      // O adaptador real é a tarefa F8.3. Enquanto ele não existe, falhar cedo
      // é melhor do que servir um provider que não envia nada.
      throw new Error(
        'MESSAGING_PROVIDER=cloud-api: adaptador real ainda não implementado (tarefa F8.3).',
      );
    default:
      throw new Error(
        `MESSAGING_PROVIDER inválido: ${JSON.stringify(provider)}. Use "mock" ou "cloud-api".`,
      );
  }
}

export { MockWhatsAppProvider };
