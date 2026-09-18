import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isDevConsoleEnabled } from './guard';

export const dynamic = 'force-dynamic';

export default function DevConsoleIndexPage() {
  if (!isDevConsoleEnabled()) {
    notFound();
  }

  return (
    <main className="flex flex-col gap-3">
      <p className="text-sm text-[var(--color-secondary)]">
        Ferramentas de desenvolvimento dos mocks. Nada aqui existe em produção.
      </p>
      <ul className="flex flex-col gap-2 text-sm">
        <li>
          <Link className="underline" href="/dev/outbox">
            /dev/outbox
          </Link>{' '}
          — mensagens enviadas pelo mock do WhatsApp, com o código OTP visível.
        </li>
        <li>
          <Link className="underline" href="/dev/payments">
            /dev/payments
          </Link>{' '}
          — cobranças, assinaturas e KYC do mock de pagamentos.
        </li>
      </ul>
    </main>
  );
}
