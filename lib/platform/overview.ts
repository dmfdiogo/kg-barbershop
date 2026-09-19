import { requireSuperAdmin } from '@/lib/auth/rbac';
import { asPlatformAdmin } from '@/lib/tenant/db';
import type { PlatformMetrics, PlatformTenantRow } from './metrics';
import { computePlatformMetrics } from './metrics';

/**
 * Diretório do painel da plataforma (tarefa F7.3).
 *
 * O QUE ESTE MÓDULO É, E O QUE NÃO É. Aqui mora o OLHO GLOBAL do Super Admin: a
 * lista de todos os tenants (nome, status, plano, uso, KYC). Por definição isso
 * atravessa tenants: não existe `forTenant()` para uma consulta que não tem um
 * tenant no caminho.
 *
 * Por que usa `asPlatformAdmin()` direto e não `withPlatformAudit()`: o
 * `AuditLog` é POR TENANT (`audit_log.tenant_id` é FK de `tenant`), desenhado
 * para responder "quem olhou o dado DESTE salão?". Não há como registrar uma
 * leitura global sem inventar um tenant ou gravar N linhas por carregamento de
 * tela — o ruído que a F1.4 explicitamente rejeitou ao tirar o roteamento da
 * auditoria. O caminho auditado é o ATO DE SUPORTE, a leitura de UM tenant
 * escolhido a dedo (`lib/platform/support.ts`), que é o que a F7.3 exige que
 * deixe rastro. Este módulo revalida o portão (`requireSuperAdmin`) a cada
 * chamada, então esconder link no menu não é o controle de acesso.
 *
 * A aritmética das métricas vive em `./metrics.ts`, pura e testável sem banco.
 */

export {
  computePlatformMetrics,
  isTenantInTrial,
  type PlatformMetrics,
  type PlatformTenantRow,
} from './metrics';

/** Diretório completo, do tenant mais novo ao mais antigo. */
export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  await requireSuperAdmin();

  const rows = await asPlatformAdmin((tx) =>
    tx.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        createdAt: true,
        trialBookingsUsed: true,
        platformSub: { select: { plan: true, status: true } },
        asaasAccount: { select: { kycStatus: true } },
        // "Uso" do plano é agenda ativa (profissional), o mesmo recurso que o
        // limite do F7.0 conta. `_count` filtrado evita trazer os perfis só
        // para contar no processo da aplicação.
        _count: { select: { staffProfiles: { where: { active: true } } } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    plan: row.platformSub?.plan ?? null,
    subscriptionStatus: row.platformSub?.status ?? null,
    activeAgendas: row._count.staffProfiles,
    trialBookingsUsed: row.trialBookingsUsed,
    kycStatus: row.asaasAccount?.kycStatus ?? null,
  }));
}

export interface PlatformOverview {
  tenants: PlatformTenantRow[];
  metrics: PlatformMetrics;
}

/** Diretório + métricas em uma leitura, para a tela de visão geral. */
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const tenants = await listPlatformTenants();
  return { tenants, metrics: computePlatformMetrics(tenants) };
}
