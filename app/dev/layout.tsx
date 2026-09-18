import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isDevConsoleEnabled } from './guard';

export const dynamic = 'force-dynamic';

export default function DevConsoleLayout({ children }: { children: React.ReactNode }) {
  // Bloqueio no servidor (contexto-comum §5.3): em produção o console inteiro
  // responde 404, mesmo que alguém descubra a URL.
  if (!isDevConsoleEnabled()) {
    notFound();
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--color-secondary)]">
            Console de desenvolvimento
          </p>
          <p className="text-lg font-semibold">Mock providers</p>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link className="underline" href="/dev/outbox">
            Outbox
          </Link>
          <Link className="underline" href="/dev/payments">
            Pagamentos
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
