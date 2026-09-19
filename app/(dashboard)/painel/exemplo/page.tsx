import { EmptyState } from '@/components/dashboard/states';

export default function ExemploPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Exemplo</h1>
      <p className="mt-1 text-sm text-[var(--color-secondary)]">
        Página de demonstração do shell do painel. As telas reais entram nas tarefas F2.1 a F2.4.
      </p>
      <div className="mt-6">
        <EmptyState
          title="Nada por aqui ainda"
          description="Esta rota existe para provar a descoberta automática do menu, sem arquivo-lista central."
        />
      </div>
    </section>
  );
}
