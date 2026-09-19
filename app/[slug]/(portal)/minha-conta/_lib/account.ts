import type { TenantContext } from '@/lib/tenant/context';
import { isWithinCancellationWindow } from '@/lib/booking/availability';
import { dateTimeLabel, upcomingDays } from '../../agendar/_lib/format';
import { PORTAL_DAY_WINDOW } from '../../agendar/_lib/availability';
import type { AccountBooking, AccountData } from './types';

/**
 * Leitura dos agendamentos do cliente logado (F3.4).
 *
 * Toda consulta passa pelo client escopado. A RLS já isola o tenant; o filtro
 * `customerId` por cima é a segunda trava do isolamento POR CLIENTE — sem ele,
 * o cliente veria os agendamentos de qualquer pessoa do mesmo salão. O
 * `TenantMember.id` vem da sessão (lido do banco), nunca de input.
 *
 * A divisão próximos/histórico é de negócio, não de query: só CONFIRMED e
 * PENDING futuros são "próximos" e ganham ação. O resto (passados, cancelados,
 * concluídos, no-show) é histórico.
 */

const ACTIVE_STATUSES = new Set(['CONFIRMED', 'PENDING']);

export async function loadAccountBookings(
  ctx: TenantContext,
  memberId: string,
  now: Date = new Date(),
): Promise<AccountData> {
  const timezone = ctx.tenant.timezone;

  const { rows, cancellationWindowHours } = await ctx.forTenant(async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      select: { cancellationWindowHours: true },
    });

    const rows = await tx.booking.findMany({
      where: { tenantId: ctx.tenant.id, customerId: memberId },
      orderBy: { startsAt: 'desc' },
      select: {
        id: true,
        serviceId: true,
        staffId: true,
        startsAt: true,
        status: true,
        priceCents: true,
        service: { select: { name: true, durationMin: true, paymentMode: true } },
        staff: {
          select: { tenantMember: { select: { user: { select: { name: true } } } } },
        },
      },
    });

    return { rows, cancellationWindowHours: tenant.cancellationWindowHours };
  });

  const upcoming: AccountBooking[] = [];
  const history: AccountBooking[] = [];

  for (const row of rows) {
    const active = ACTIVE_STATUSES.has(row.status);
    const future = row.startsAt.getTime() >= now.getTime();

    const booking: AccountBooking = {
      id: row.id,
      serviceId: row.serviceId,
      staffId: row.staffId,
      serviceName: row.service.name,
      staffName: row.staff.tenantMember.user.name,
      startsAt: row.startsAt.toISOString(),
      startsAtLabel: dateTimeLabel(row.startsAt, timezone),
      durationMin: row.service.durationMin,
      priceCents: row.priceCents,
      paymentMode: row.service.paymentMode,
      status: row.status,
      canManage:
        active &&
        future &&
        isWithinCancellationWindow({
          startsAt: row.startsAt,
          cancellationWindowHours,
          now,
        }),
    };

    if (active && future) upcoming.push(booking);
    else history.push(booking);
  }

  upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  return {
    timezone,
    dates: upcomingDays(timezone, PORTAL_DAY_WINDOW, now),
    upcoming,
    history,
    cancellationWindowHours,
  };
}
