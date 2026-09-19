import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getMembership } from '@/lib/auth/membership';
import { getSession } from '@/lib/auth/session';
import { CheckoutError, loadCheckoutQuote, type CheckoutQuote } from '@/lib/payments/charge';
import { getTenantContext, toTenantContext } from '@/lib/tenant/context';
import { portalBasePath } from '@/components/portal/paths';
import { CheckoutFlow } from './_components/CheckoutFlow';

/**
 * Checkout do portal `/[slug]/checkout?reserva=<bookingId>` (F4.2).
 *
 * Entra DEPOIS da identificação por OTP do fluxo da F3.3: o hold já existe e o
 * cliente já tem sessão. A página é SSR — mostra serviço, valor, taxa da
 * plataforma e o tempo restante da janela de 10 minutos — e entrega a decisão ao
 * componente de cliente, que chama a server action de checkout.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getTenantContext(slug);
  return lookup.ok ? { title: `Pagamento · ${lookup.tenant.name}` } : { title: 'Pagamento' };
}

function firstParam(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function Notice({ title, message, basePath }: { title: string; message: string; basePath: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-[var(--color-secondary)]">{message}</p>
      <a
        href={basePath || '/'}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-center text-sm font-semibold text-[var(--color-primary-foreground)]"
      >
        Voltar ao início
      </a>
    </section>
  );
}

export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const lookup = await getTenantContext(slug);
  if (!lookup.ok) notFound();

  const ctx = toTenantContext(lookup);
  const basePath = portalBasePath(lookup);

  const session = await getSession();
  if (!session) {
    return (
      <Notice
        title="Falta confirmar seu WhatsApp"
        message="Para pagar, volte ao agendamento e confirme o seu WhatsApp. O horário fica reservado por 10 minutos."
        basePath={basePath}
      />
    );
  }

  const member = await getMembership(ctx.tenant.id, session.userId);
  if (!member) {
    return (
      <Notice
        title="Sessão não encontrada"
        message="Entre novamente para concluir o pagamento."
        basePath={basePath}
      />
    );
  }

  const holdId = firstParam(query.reserva);
  if (!holdId) {
    return (
      <Notice
        title="Reserva não informada"
        message="O link de pagamento está incompleto. Volte ao agendamento e escolha o horário novamente."
        basePath={basePath}
      />
    );
  }

  let quote: CheckoutQuote;
  try {
    quote = await loadCheckoutQuote({
      ctx,
      holdId,
      memberId: member.id,
    });
  } catch (error) {
    const message =
      error instanceof CheckoutError
        ? error.message
        : 'Não foi possível carregar o pagamento agora.';
    return <Notice title="Reserva indisponível" message={message} basePath={basePath} />;
  }

  return <CheckoutFlow quote={quote} />;
}
