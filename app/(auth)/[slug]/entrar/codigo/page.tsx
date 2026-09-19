import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OTP_RESEND_COOLDOWN_SECONDS } from '@/lib/auth/otp';
import { getTenantContext } from '@/lib/tenant/context';
import { AuthCard } from '../../../_components/AuthCard';
import { AuthNotice } from '../../../_components/AuthNotice';
import { OtpCodeForm } from '../../../_components/OtpCodeForm';
import { formatPhoneForDisplay } from '../../../_lib/phone';
import { readPendingIdentity } from '../../../_lib/pending';
import { safeNextPath } from '../../../_lib/redirect';
import { firstSearchParam, identifyPath, type SearchParamsRecord } from '../../../_lib/routes';

export const metadata: Metadata = { title: 'Digite o código' };

export default async function TenantCodigoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const lookup = await getTenantContext(slug);

  if (!lookup.ok) {
    if (lookup.reason === 'suspended') {
      return (
        <AuthNotice title="Estabelecimento temporariamente suspenso">
          {lookup.tenant?.name
            ? `O portal de ${lookup.tenant.name} está fora do ar temporariamente.`
            : 'Este portal está fora do ar temporariamente.'}
        </AuthNotice>
      );
    }
    notFound();
  }

  const basePath = `/${lookup.tenant.slug}`;
  const pending = await readPendingIdentity();

  if (!pending) {
    return (
      <AuthNotice
        title="Sua identificação expirou"
        actionHref={identifyPath(basePath)}
        actionLabel="Informar nome e WhatsApp"
      >
        O tempo para confirmar o código terminou. Recomece a identificação para
        receber um código novo.
      </AuthNotice>
    );
  }

  return (
    <AuthCard
      eyebrow={lookup.tenant.name}
      title="Digite o código"
      subtitle="O código tem 6 dígitos e vale por 5 minutos."
    >
      <OtpCodeForm
        phone={pending.phone}
        displayPhone={formatPhoneForDisplay(pending.phone)}
        name={pending.name}
        identifyHref={identifyPath(basePath)}
        nextPath={safeNextPath(firstSearchParam(query, 'next'))}
        basePath={basePath}
        cooldownSeconds={OTP_RESEND_COOLDOWN_SECONDS}
      />
    </AuthCard>
  );
}
