'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ServiceForm } from '@/app/(dashboard)/painel/servicos/_components/ServiceForm';
import { completeOnboardingStepAction } from '../actions';
import type { ServiceView, StaffOption } from '@/lib/catalog/types';

/**
 * Passo 3 — primeiro serviço (tarefa F2.5).
 *
 * NÃO reescreve o catálogo: reusa o `ServiceForm` da F2.1, que já fala com
 * `createServiceAction` e já valida duração, buffer, preço e forma de cobrança.
 * O profissional do dono vem marcado por padrão para que o primeiro serviço
 * nasça agendável, e não órfão.
 */
export function ServiceStep({
  staff,
  ownerStaffId,
}: {
  staff: StaffOption[];
  ownerStaffId: string | null;
}) {
  const router = useRouter();

  const initial: ServiceView = {
    id: '',
    name: '',
    durationMin: 30,
    bufferMin: 0,
    priceCents: 0,
    paymentMode: 'ON_SITE',
    depositCents: null,
    depositPercent: null,
    active: true,
    staffIds: ownerStaffId ? [ownerStaffId] : [],
  };

  async function handleSaved() {
    await completeOnboardingStepAction('SERVICE');
    router.push('/painel/onboarding/portal' as Route);
  }

  return <ServiceForm mode="create" initial={initial} staff={staff} onSaved={handleSaved} />;
}
