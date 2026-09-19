import { EmptyState } from '@/components/dashboard/states';

export default function ExemploConfigPage() {
  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-lg font-semibold">Configuração de exemplo</h1>
      <p className="mt-1 text-sm text-[var(--color-secondary)]">
        Área restrita ao dono. O Staff não vê este item no menu nem acessa esta rota.
      </p>
      <div className="mt-6">
        <EmptyState
          title="Em construção"
          description="As telas de configuração reais chegam nas tarefas F2.3 e F2.4."
        />
      </div>
    </section>
  );
}
