/** Esqueleto do painel. Mesmo motivo do portal: espera sem sinal parece travamento. */
export default function PainelLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="h-6 w-48 rounded-lg bg-[var(--color-muted)]" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-[var(--color-border)]" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-[var(--color-border)]" />
    </div>
  );
}
