import type { ReactNode } from 'react';

/**
 * Estados padronizados do painel, reutilizáveis pelas folhas da fase 2
 * (F2.1–F2.5). São puramente apresentacionais e sem `'use client'`: funcionam
 * como fallback de `Suspense`, em Server Component e em Client Component.
 *
 * Sem cor literal — só tokens (`contexto-comum.md` §2).
 */

interface StateAction {
  action?: ReactNode;
}

interface EmptyStateProps extends StateAction {
  title: string;
  description?: string;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-secondary)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

interface LoadingStateProps {
  label?: string;
}

export function LoadingState({ label = 'Carregando…' }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-3 px-6 py-12 text-center text-sm text-[var(--color-secondary)]"
    >
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-primary)]"
      />
      {label}
    </div>
  );
}

interface ErrorStateProps extends StateAction {
  title?: string;
  description?: string;
}

export function ErrorState({
  title = 'Algo deu errado',
  description,
  action,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-xl border border-[var(--color-danger)] px-6 py-12 text-center"
    >
      <p className="text-sm font-semibold text-[var(--color-danger)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-secondary)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}
