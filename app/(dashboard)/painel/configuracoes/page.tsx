import { requireRole } from '@/lib/auth/rbac';
import { getAppDomain } from '@/lib/tenant/slugs';
import { loadPortalSettings, loadTenantAddress, loadTenantPolicies } from './service';
import { PoliciesForm } from './_components/PoliciesForm';
import { PortalAddressForm } from './_components/PortalAddressForm';
import { TenantAddressForm } from './_components/TenantAddressForm';

/**
 * Configurações do estabelecimento (tarefa F2.4): políticas de agenda e
 * endereço do portal.
 *
 * O layout do segmento já exige OWNER; aqui só carregamos o estado atual pelo
 * client escopado (`forTenant`), nunca por leitura crua.
 */
export default async function ConfiguracoesPage() {
  const context = await requireRole('OWNER');
  const { policies, portal, address } = await context.forTenant(async (tx) => ({
    policies: await loadTenantPolicies(tx, context.tenant.id),
    portal: await loadPortalSettings(tx, context.tenant.id),
    address: await loadTenantAddress(tx, context.tenant.id),
  }));

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="text-lg font-semibold">Configurações</h1>
        <p className="mt-1 text-sm text-[var(--color-secondary)]">
          Endereço do salão, regras da agenda e o endereço público do seu portal.
        </p>
      </header>

      <TenantAddressForm initial={address} />
      <PoliciesForm initial={policies} />
      <PortalAddressForm
        initial={portal}
        appDomain={getAppDomain()}
      />
    </section>
  );
}
