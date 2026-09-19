import { isBillingPlanCode } from '@/lib/billing';
import { startSubscriptionCheckout } from '@/lib/billing/subscription';
import { errorMessage, guardDevAction, redirectToBillingConsole } from '../_shared';

/**
 * Abre uma sessão de checkout pelo MESMO caminho do produto
 * (`startSubscriptionCheckout`): cria o cliente de cobrança, grava o
 * `stripeCustomerId` no `PlatformSub` local (a âncora que o webhook usa para
 * achar o tenant) e devolve a URL hospedada. Sem isto o console seria uma tela
 * vazia: ainda não há tela de produto que chame esse fluxo.
 *
 * Nenhuma assinatura nasce aqui — só a sessão pendente. Concluir é o botão do
 * console.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = guardDevAction();
  if (denied) {
    return denied;
  }

  const form = await request.formData();
  const tenantId = String(form.get('tenantId') ?? '');
  const plan = String(form.get('plan') ?? '');

  if (!tenantId) {
    return redirectToBillingConsole({ error: 'Selecione um estabelecimento.' });
  }
  if (!isBillingPlanCode(plan)) {
    return redirectToBillingConsole({ error: `Plano inválido: ${plan}` });
  }

  const origin = new URL(request.url).origin;

  try {
    const result = await startSubscriptionCheckout({
      tenantId,
      plan,
      successUrl: `${origin}/dev/billing`,
      cancelUrl: `${origin}/dev/billing`,
    });
    if (!result.ok) {
      return redirectToBillingConsole({ error: result.message });
    }
    return redirectToBillingConsole({ sessao: result.sessionId });
  } catch (error) {
    return redirectToBillingConsole({ error: errorMessage(error) });
  }
}
