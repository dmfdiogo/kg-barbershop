import type { Metadata } from 'next';
import { OTP_RESEND_COOLDOWN_SECONDS } from '@/lib/auth/otp';
import { getTenantContext } from '@/lib/tenant/context';
import { AuthCard } from '../../_components/AuthCard';
import { AuthNotice } from '../../_components/AuthNotice';
import { OtpCodeForm } from '../../_components/OtpCodeForm';
import { formatPhoneForDisplay } from '../../_lib/phone';
import { readPendingIdentity } from '../../_lib/pending';
import { safeNextPath } from '../../_lib/redirect';
import { firstSearchParam, identifyPath, type SearchParamsRecord } from '../../_lib/routes';

export const metadata: Metadata = { title: 'Digite o código' };

export default async function CodigoPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsRecord>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(firstSearchParam(params, 'next'));
  const [lookup, pending] = await Promise.all([getTenantContext(), readPendingIdentity()]);

  if (!pending) {
    return (
      <AuthNotice
        title="Sua identificação expirou"
        actionHref={identifyPath('')}
        actionLabel="Informar nome e WhatsApp"
      >
        O tempo para confirmar o código terminou. Recomece a identificação para
        receber um código novo.
      </AuthNotice>
    );
  }

  return (
    <AuthCard
      eyebrow={lookup.ok ? lookup.tenant.name : null}
      title="Digite o código"
      subtitle="O código tem 6 dígitos e vale por 5 minutos."
    >
      <OtpCodeForm
        phone={pending.phone}
        displayPhone={formatPhoneForDisplay(pending.phone)}
        name={pending.name}
        identifyHref={identifyPath('')}
        nextPath={nextPath}
        basePath=""
        cooldownSeconds={OTP_RESEND_COOLDOWN_SECONDS}
      />
    </AuthCard>
  );
}
