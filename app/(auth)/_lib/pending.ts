import { cookies } from 'next/headers';
import { OTP_PENDING_COOKIE_NAME, decodePendingIdentity } from '@/lib/auth/otp';

/**
 * Lê a identidade pendente do primeiro acesso (F1.2).
 *
 * O cookie é assinado, httpOnly e de 5 minutos — o mesmo TTL do desafio. Se ele
 * sumiu, o código também não vale mais: é assim que a tela do código sabe
 * avisar que a identificação expirou em vez de pedir um código órfão.
 */
export async function readPendingIdentity(): Promise<{ phone: string; name: string } | null> {
  const store = await cookies();
  return decodePendingIdentity(store.get(OTP_PENDING_COOKIE_NAME)?.value);
}
