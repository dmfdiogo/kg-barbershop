import { requireRole } from '@/lib/auth/rbac';
import { listMessagingOverview } from '@/lib/messaging/preferences';
import { MessagingPanel } from './_components/MessagingPanel';

export default async function MensagensPage() {
  const context = await requireRole('OWNER');
  const overview = await context.forTenant((tx) =>
    listMessagingOverview(tx, context.tenant.id),
  );

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Mensagens e privacidade</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Quem aceita receber, quem pediu para parar, o que foi de fato enviado — e
          as ferramentas para atender aos pedidos de acesso e exclusão do titular.
        </p>
      </header>

      <MessagingPanel overview={overview} timeZone={context.tenant.timezone} />
    </section>
  );
}
