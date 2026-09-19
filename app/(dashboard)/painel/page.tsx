import { EmptyState } from '@/components/dashboard/states';

/**
 * Início do painel (tronco F2.0). O shell (layout do segmento) já envolve esta
 * página com cabeçalho e menu; aqui só entra o conteúdo. O dashboard
 * operacional de verdade é a F2.4.
 */
export default function PainelHomePage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Painel do estabelecimento</h1>
      <p className="mt-1 text-sm text-[var(--color-secondary)]">
        Escolha uma área no menu. Serviços, equipe, marca e políticas chegam nas próximas tarefas
        da fase 2.
      </p>
      <div className="mt-6">
        <EmptyState
          title="Seu painel está pronto"
          description="Esta é a casca da fase 2. As ferramentas aparecem conforme forem entregues."
        />
      </div>
    </section>
  );
}
