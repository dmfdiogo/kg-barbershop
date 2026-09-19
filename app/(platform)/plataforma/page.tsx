import { getPlatformOverview } from '@/lib/platform/overview';
import { MetricCards, TenantTable } from './_components/OverviewPanels';

/**
 * Visão geral da plataforma (tarefa F7.3).
 *
 * O portão e a casca vêm de `plataforma/layout.tsx` (F1.4 estendido). Aqui só
 * se lê o diretório e as métricas; abrir a ficha de um salão é outra tela,
 * justamente para que o ato de suporte (auditado) seja explícito.
 */
export default async function PlataformaPage() {
  const { tenants, metrics } = await getPlatformOverview();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-lg font-semibold">Visão geral</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Estabelecimentos, assinaturas e saúde do negócio. O acesso ao dado de um
          salão para suporte fica registrado na auditoria dele.
        </p>
      </header>

      <MetricCards metrics={metrics} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Estabelecimentos</h2>
        <TenantTable tenants={tenants} />
      </section>
    </div>
  );
}
