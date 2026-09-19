'use server';

import { revalidatePath } from 'next/cache';
import { AuthError, requireRole, type RequestContext } from '@/lib/auth/rbac';
import { isBillingPlanCode } from '@/lib/billing/plans';
import {
  cancelSubscription,
  changePlan,
  openBillingPortal,
  startSubscriptionCheckout,
} from '@/lib/billing/subscription';
import { absoluteUrl, requestOrigin } from './_lib/origin';
import type {
  CancelSubscriptionSuccess,
  ChangePlanSuccess,
  OpenPortalSuccess,
  StartCheckoutSuccess,
  SubscriptionActionFailure,
  SubscriptionActionResult,
} from './_lib/types';

/**
 * Server actions da assinatura da plataforma (tarefa F8.0-B).
 *
 * REGRAS:
 *
 * 1. **Toda action revalida `requireRole('OWNER')`.** O portão do layout barra
 *    a navegação, mas esconder o link não é controle de acesso — estas são as
 *    funções que mexem em dinheiro. O tenant nunca vem do cliente: sai do
 *    contexto autenticado.
 * 2. **Casca fina.** Nada de regra aqui: valida a forma da entrada, monta a
 *    URL de retorno e delega a `lib/billing/subscription.ts`, que chama o
 *    provedor FORA da transação escopada (a callback pode rodar duas vezes sob
 *    P2034 e chamada externa lá dentro duplicaria cobrança).
 * 3. **O cartão nunca passa por aqui.** Assinar e trocar cartão são
 *    redirecionamentos para páginas hospedadas; esta tela não recebe PAN.
 * 4. **Downgrade é decisão explícita.** `deactivateStaffIds` sobe como escolha
 *    do dono; sem cobrir o excesso, `changePlan` recusa e NADA é gravado.
 */

const PAGE_PATH = '/painel/assinatura';

function fail(
  code: SubscriptionActionFailure['code'],
  message: string,
  assessment?: SubscriptionActionFailure['assessment'],
): SubscriptionActionFailure {
  return assessment ? { ok: false, code, message, assessment } : { ok: false, code, message };
}

type OwnerGuard =
  | { ok: true; context: RequestContext }
  | { ok: false; result: SubscriptionActionFailure };

async function ownerOrForbidden(): Promise<OwnerGuard> {
  try {
    return { ok: true, context: await requireRole('OWNER') };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        result: fail('FORBIDDEN', 'Você não tem acesso a esta área.'),
      };
    }
    throw error;
  }
}

function unexpected(error: unknown): SubscriptionActionFailure {
  console.error('[assinatura] erro inesperado', error);
  return fail(
    'UNAVAILABLE',
    'Não foi possível falar com o provedor de pagamento agora. Tente novamente em instantes.',
  );
}

/** `successUrl`/`cancelUrl`/`returnUrl` têm de ser absolutas: o provedor recusa relativa. */
async function originOrFailure(): Promise<
  { ok: true; origin: string } | { ok: false; result: SubscriptionActionFailure }
> {
  const origin = await requestOrigin();
  if (!origin) {
    return {
      ok: false,
      result: fail(
        'NO_ORIGIN',
        'Não foi possível montar o endereço de retorno. Recarregue a página e tente de novo.',
      ),
    };
  }
  return { ok: true, origin };
}

// ---------------------------------------------------------------------------
// Assinar (Checkout hospedado)
// ---------------------------------------------------------------------------

/**
 * Inicia o Checkout hospedado do plano escolhido e devolve a URL absoluta.
 *
 * Quando isto retorna, NÃO existe assinatura: o cartão é digitado na página do
 * provedor e a assinatura nasce lá, chegando por webhook. A tela que recebe a
 * `successUrl` mostra "aguardando confirmação" até o evento chegar.
 */
export async function startCheckoutAction(
  plan: string,
): Promise<SubscriptionActionResult<StartCheckoutSuccess>> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return auth.result;
  if (!isBillingPlanCode(plan)) {
    return fail('INVALID_PLAN', 'Escolha um dos planos disponíveis.');
  }

  const origin = await originOrFailure();
  if (!origin.ok) return origin.result;

  try {
    const result = await startSubscriptionCheckout({
      tenantId: auth.context.tenant.id,
      plan,
      successUrl: absoluteUrl(origin.origin, `${PAGE_PATH}?checkout=concluido`),
      cancelUrl: absoluteUrl(origin.origin, `${PAGE_PATH}?checkout=cancelado`),
    });

    if (!result.ok) {
      if (result.code === 'SUBSCRIBER_ALREADY_EXISTS') {
        return fail(
          'ALREADY_SUBSCRIBED',
          'O estabelecimento já possui uma assinatura. Atualize a página para ver o estado atual.',
        );
      }
      return fail('UNAVAILABLE', result.message);
    }

    revalidatePath(PAGE_PATH);
    return { ok: true, url: result.url };
  } catch (error) {
    return unexpected(error);
  }
}

// ---------------------------------------------------------------------------
// Portal hospedado (cartão e faturas)
// ---------------------------------------------------------------------------

/** Abre o portal do provedor: trocar cartão e ver/baixar faturas. */
export async function openPortalAction(): Promise<
  SubscriptionActionResult<OpenPortalSuccess>
> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return auth.result;

  const origin = await originOrFailure();
  if (!origin.ok) return origin.result;

  try {
    const result = await openBillingPortal({
      tenantId: auth.context.tenant.id,
      returnUrl: absoluteUrl(origin.origin, `${PAGE_PATH}?checkout=portal`),
    });
    if (!result.ok) {
      return fail('NO_SUBSCRIPTION', result.message);
    }
    return { ok: true, url: result.url };
  } catch (error) {
    return unexpected(error);
  }
}

// ---------------------------------------------------------------------------
// Trocar de plano (com decisão de downgrade)
// ---------------------------------------------------------------------------

/**
 * Aplica a troca de plano. Em downgrade que aperta o limite, `deactivateStaffIds`
 * precisa cobrir o excesso — sem isso a troca é recusada e nada é gravado. A
 * proração é calculada pelo provedor a partir do `stripeSubscriptionId`.
 */
export async function changePlanAction(
  plan: string,
  deactivateStaffIds: string[] = [],
): Promise<SubscriptionActionResult<ChangePlanSuccess>> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return auth.result;
  if (!isBillingPlanCode(plan)) {
    return fail('INVALID_PLAN', 'Escolha um dos planos disponíveis.');
  }
  const staffIds = Array.isArray(deactivateStaffIds)
    ? deactivateStaffIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  try {
    const result = await changePlan({
      tenantId: auth.context.tenant.id,
      plan,
      deactivateStaffIds: staffIds,
    });

    if (!result.ok) {
      return fail(result.code, result.message, result.assessment);
    }

    revalidatePath(PAGE_PATH);
    return {
      ok: true,
      plan: result.plan,
      deactivatedStaffIds: result.deactivatedStaffIds,
    };
  } catch (error) {
    return unexpected(error);
  }
}

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

/**
 * Cancela a assinatura. `atPeriodEnd = true` mantém o acesso até o fim do
 * período pago; `false` encerra imediatamente. O estado local só muda quando o
 * webhook do provedor chega — por isso o retorno é informativo.
 */
export async function cancelSubscriptionAction(
  atPeriodEnd: boolean,
): Promise<SubscriptionActionResult<CancelSubscriptionSuccess>> {
  const auth = await ownerOrForbidden();
  if (!auth.ok) return auth.result;

  try {
    const result = await cancelSubscription({
      tenantId: auth.context.tenant.id,
      atPeriodEnd: atPeriodEnd === true,
    });
    if (!result.ok) {
      return fail('NO_SUBSCRIPTION', result.message);
    }

    revalidatePath(PAGE_PATH);
    return {
      ok: true,
      cancelAtPeriodEnd: result.providerSubscription.cancelAtPeriodEnd,
      currentPeriodEnd: result.providerSubscription.currentPeriodEnd,
    };
  } catch (error) {
    return unexpected(error);
  }
}
