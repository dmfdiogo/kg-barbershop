'use client';

/**
 * Erro inesperado no painel do estabelecimento.
 *
 * O tom é diferente do portal de propósito: aqui quem lê é o dono, que tem
 * como agir e a quem interessa o código do erro para pedir suporte.
 */
export default function PainelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-8" role="alert">
      <h1 className="text-xl font-semibold">Não foi possível carregar esta tela</h1>
      <p className="text-sm text-[var(--color-secondary)]">
        O erro foi registrado. Tente de novo; se continuar, informe o código abaixo ao
        suporte — é por ele que encontramos o que aconteceu.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-[var(--color-primary)] px-4 py-3 text-sm font-semibold text-[var(--color-background)]"
      >
        Tentar de novo
      </button>
      {error.digest ? (
        <p className="text-xs text-[var(--color-secondary)]">
          Código do erro: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
    </div>
  );
}
