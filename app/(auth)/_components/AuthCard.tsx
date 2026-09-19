import type { ReactNode } from 'react';

/**
 * Cartão das telas de login (F1.2). Só apresentação: título, eventual nome do
 * estabelecimento e o campo de trabalho. Mantém as duas telas — identificação e
 * código — com a mesma cara.
 */
export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string | null;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 sm:p-6">
      <header className="flex flex-col gap-1">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-secondary)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="text-sm text-[var(--color-secondary)]">{subtitle}</p> : null}
      </header>

      {children}

      {footer ? <div className="text-sm text-[var(--color-secondary)]">{footer}</div> : null}
    </section>
  );
}
