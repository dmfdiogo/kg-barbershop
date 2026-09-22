'use client';

/**
 * Erro inesperado no portal do estabelecimento.
 *
 * Sem este arquivo, uma falha não tratada mostra a tela padrão do Next — em
 * produção, um "Application error" em inglês, sem identidade e sem saída. Para
 * o cliente do salão isso é indistinguível de site fora do ar, e ele liga para
 * o salão ou desiste do agendamento.
 *
 * A mensagem NÃO mostra o erro técnico: quem está do outro lado não pode fazer
 * nada com ele, e detalhe de stack em tela pública é superfície de ataque. O
 * `digest` aparece porque é o que liga esta tela ao log do servidor quando o
 * dono do salão relata o problema.
 */
export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-4 py-8" role="alert">
      <h1 className="text-xl font-semibold">Algo deu errado por aqui</h1>
      <p className="text-sm text-[var(--color-secondary)]">
        Não conseguimos carregar esta página agora. Tente de novo em instantes — seus
        agendamentos continuam salvos.
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
