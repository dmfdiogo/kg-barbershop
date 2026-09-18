'use server';

import { destroySession } from './session';
import type {
  RequestOtpInput,
  RequestOtpResult,
  VerifyOtpInput,
  VerifyOtpResult,
} from './types';

/**
 * Contrato das server actions de autenticação (F1.0).
 *
 * A F1.2 consome estas funções SEM conhecê-las por dentro; a F1.1 implementa o
 * corpo (desafio/hash/TTL/rate limit em `lib/auth/otp.ts`). NÃO mude as
 * assinaturas: as duas tarefas rodam em paralelo contra este arquivo.
 *
 * Regras que a implementação precisa respeitar (fase-1, item 2):
 *   - o tenant vem de `requireTenantContext()`, nunca de um parâmetro vindo do
 *     cliente;
 *   - resposta e tempo idênticos para telefone conhecido e desconhecido;
 *   - mensagem de erro pronta em pt-BR (a tela só exibe);
 *   - sucesso do verify estabelece a sessão (`establishSession`) e devolve o
 *     papel LIDO DO BANCO (`TenantMember`), nunca de token.
 *
 * Enquanto a F1.1 não chega, `requestOtpAction`/`verifyOtpAction` lançam erro
 * explícito — melhor que devolver sucesso falso e esconder a lacuna.
 */

export async function requestOtpAction(input: RequestOtpInput): Promise<RequestOtpResult> {
  void input;
  throw new Error(
    'requestOtpAction ainda não implementada: o fluxo OTP é a tarefa F1.1 (lib/auth/otp.ts).',
  );
}

export async function verifyOtpAction(input: VerifyOtpInput): Promise<VerifyOtpResult> {
  void input;
  throw new Error(
    'verifyOtpAction ainda não implementada: o fluxo OTP é a tarefa F1.1 (lib/auth/otp.ts).',
  );
}

/** Encerra a sessão atual. Já funcional: não depende do OTP. */
export async function logoutAction(): Promise<void> {
  await destroySession();
}
