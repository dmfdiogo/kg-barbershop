import { notFound } from 'next/navigation';
import { listOutboxMessages } from '@/lib/messaging/outbox';
import { formatDateTime } from '../format';
import { isDevConsoleEnabled } from '../guard';

export const dynamic = 'force-dynamic';

export default function OutboxPage() {
  if (!isDevConsoleEnabled()) {
    notFound();
  }

  const messages = listOutboxMessages();

  return (
    <main className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Outbox do WhatsApp</h2>
        <p className="text-sm text-[var(--color-secondary)]">
          {messages.length} mensagem(ns)
        </p>
      </div>

      {messages.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-secondary)]">
          Nenhuma mensagem enviada ainda. O código OTP do login aparece aqui.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {messages.map((message) => (
            <li key={message.id} className="flex flex-col gap-1 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-xs">{message.template}</span>
                <span className="text-[var(--color-secondary)]">
                  {formatDateTime(message.sentAt)}
                </span>
                <span className="text-[var(--color-secondary)]">para {message.to}</span>
              </div>

              {message.code ? (
                <p>
                  OTP:{' '}
                  <code className="rounded bg-[var(--color-muted)] px-2 py-0.5 font-mono text-lg">
                    {message.code}
                  </code>
                </p>
              ) : (
                <p className="text-[var(--color-secondary)]">
                  {Object.entries(message.vars)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(' · ')}
                </p>
              )}

              <p className="font-mono text-xs text-[var(--color-secondary)]">
                {message.providerMessageId}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
