'use client';

import { useState } from 'react';

/**
 * Link pronto para colar no WhatsApp (tarefa F2.5, critério §9.2).
 *
 * O botão de copiar usa a Clipboard API e tem um estado de confirmação para o
 * dono saber que funcionou; o link do WhatsApp abre a conversa com o texto já
 * preenchido. Nenhuma cor literal — tudo por token.
 */
export function PortalLinkReady({ url, tenantName }: { url: string; tenantName: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const shareText = `Agende seu horário em ${tenantName}: ${url}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--color-border)] p-5">
      <div>
        <p className="text-sm font-medium">Link do portal</p>
        <p className="mt-1 break-all text-xs text-[var(--color-secondary)]">{url}</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-background)] transition-opacity hover:opacity-90"
        >
          {copied ? 'Copiado!' : 'Copiar link'}
        </button>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-center text-sm font-medium text-[var(--color-secondary)] transition-colors hover:bg-[var(--color-muted)]"
        >
          Compartilhar no WhatsApp
        </a>
      </div>

      {copied ? (
        <span role="status" className="text-xs text-[var(--color-success)]">
          Link copiado para a área de transferência.
        </span>
      ) : null}
    </div>
  );
}
