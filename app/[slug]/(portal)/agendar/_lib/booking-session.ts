import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

/**
 * Sessão de agendamento do dispositivo (F3.3).
 *
 * É o `holdSessionId` da F3.2: amarra o hold a quem o criou. Sem dono, um bot
 * segura a agenda inteira do salão por dez minutos (armadilha conhecida da
 * fase). O cookie é httpOnly e assinado? Não precisa de assinatura: o valor é
 * um UUID opaco, não carrega identidade, e o banco é quem valida a posse
 * comparando `Booking.holdSessionId` no confirmar. Ainda assim é `secure` e
 * `sameSite=lax`, como a sessão.
 */

export const BOOKING_SESSION_COOKIE = 'kg_booking_session';

const BOOKING_SESSION_MAX_AGE_SECONDS = 60 * 60 * 6;

export async function readBookingSessionId(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(BOOKING_SESSION_COOKIE)?.value;
  return value && value.length > 0 ? value : null;
}

/**
 * Devolve o id da sessão do dispositivo, criando-o na primeira ação que precisa
 * dele (a criação do hold). Só pode ser chamada de Server Action/Route Handler,
 * onde a escrita de cookie é permitida.
 */
export async function getOrCreateBookingSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(BOOKING_SESSION_COOKIE)?.value;
  if (existing && existing.length > 0) return existing;

  const id = randomUUID();
  store.set(BOOKING_SESSION_COOKIE, id, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: BOOKING_SESSION_MAX_AGE_SECONDS,
  });
  return id;
}
