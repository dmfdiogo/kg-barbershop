/**
 * Esqueleto do portal enquanto o servidor busca catálogo e tema.
 *
 * Sem `loading.tsx` o Next segura a navegação e a tela anterior fica parada:
 * em rede ruim — que é a rede do cliente do salão — parece travamento, e a
 * pessoa toca de novo ou desiste. O esqueleto não deixa a espera mais rápida;
 * deixa visível que alguma coisa está acontecendo.
 *
 * Sem animação de pulso de propósito: o portal usa a cor da marca do tenant, e
 * um pulso colorido em tela cheia briga com o conteúdo que vai entrar.
 */
export default function PortalLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="h-7 w-2/3 rounded-lg bg-[var(--color-muted)]" />
      <div className="h-4 w-1/2 rounded-lg bg-[var(--color-muted)]" />
      <div className="mt-2 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-[var(--color-border)]" />
        ))}
      </div>
    </div>
  );
}
