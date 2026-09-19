import { confirmBooking, ConfirmBookingError } from '@/lib/booking/confirm';
import { createHold, HoldError, type CreatedHold } from '@/lib/booking/hold';
import { selectStaffForSlot } from '@/lib/booking/availability';
import type { TenantContext } from '@/lib/tenant/context';
import { isSlotUnavailableError } from '@/lib/tenant/errors';
import {
  buildLoads,
  buildSlotOptions,
  dayOfInstant,
  loadDayState,
  type LoadedDay,
} from './availability';
import { dateTimeLabel, timeLabel } from './format';
import type { BookingErrorCode, ConfirmedInfo, HoldInfo } from './types';

/**
 * Orquestração do fluxo de agendamento (F3.3): lógica testável sem runtime do
 * Next. Os server actions (`../actions.ts`) são casca fina de cookies e
 * resolução de tenant; tudo o que decide negócio mora aqui, para os testes de
 * integração exercitarem o caminho real com banco.
 */

const ERROR_STATUS: Record<BookingErrorCode, number> = {
  INVALID_INPUT: 400,
  TENANT_UNAVAILABLE: 404,
  SERVICE_NOT_FOUND: 404,
  SLOT_UNAVAILABLE: 409,
  BOOKING_NOT_FOUND: 404,
  UNAUTHENTICATED: 401,
  CONFLICT: 409,
};

export class PortalBookingError extends Error {
  readonly code: BookingErrorCode;
  readonly status: number;

  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = 'PortalBookingError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export interface CreateHoldParams {
  ctx: TenantContext;
  serviceId: string;
  /** `null` = "qualquer um" (escolhe por carga). */
  staffId: string | null;
  /** Instante UTC do slot escolhido na grade. */
  startsAt: Date;
  /**
   * `TenantMember.id` do cliente já identificado, quando há sessão. Ausente no
   * caso normal do portal: o hold nasce anônimo (`Booking.customerId` nulo) e o
   * cliente é gravado na confirmação, depois do OTP.
   */
  customerId?: string | null;
  /** Sessão do dispositivo (cookie), que amarra o hold a quem o criou. */
  holdSessionId: string;
  /** `true` quando o cliente já tem sessão e o OTP pode ser pulado. */
  authenticated: boolean;
  now?: Date;
}

function holdInfo(
  hold: CreatedHold,
  loaded: LoadedDay,
  staffName: string,
  authenticated: boolean,
): HoldInfo {
  return {
    holdId: hold.id,
    service: loaded.service,
    staffName,
    startsAt: hold.startsAt.toISOString(),
    expiresAt: hold.holdExpiresAt.toISOString(),
    startsAtLabel: dateTimeLabel(hold.startsAt, loaded.timezone),
    authenticated,
  };
}

/**
 * Cria o hold do slot escolhido.
 *
 * A checagem da grade é só para a mensagem ficar bonita e para escolher o
 * profissional do "qualquer um"; a garantia real é a exclusion constraint do
 * banco, e `createHold` já traduz a violação para `SlotUnavailableError`.
 */
export async function createBookingHold(params: CreateHoldParams): Promise<HoldInfo> {
  const { ctx, serviceId, staffId, startsAt, customerId, holdSessionId } = params;
  const now = params.now ?? new Date();

  if (!serviceId) throw new PortalBookingError('INVALID_INPUT', 'Informe o serviço.');
  if (!(startsAt instanceof Date) || Number.isNaN(startsAt.getTime())) {
    throw new PortalBookingError('INVALID_INPUT', 'Horário inválido.');
  }
  if (!holdSessionId) {
    throw new PortalBookingError('INVALID_INPUT', 'Sessão de agendamento ausente.');
  }

  const date = dayOfInstant(startsAt, ctx.tenant.timezone);
  const loaded = await loadDayState(ctx, serviceId, staffId, date);
  if (!loaded) {
    if (staffId === null) throw new PortalBookingError('SERVICE_NOT_FOUND', 'Serviço não encontrado.');
    // Serviço existe, mas o profissional escolhido não o atende/não está ativo:
    // do ponto de vista do cliente, o horário simplesmente não existe.
    throw new PortalBookingError('SLOT_UNAVAILABLE', 'Horário indisponível. Escolha outro.');
  }

  const slotIso = startsAt.toISOString();
  const slotValues = new Set(buildSlotOptions(loaded, now).map((slot) => slot.value));
  if (!slotValues.has(slotIso)) {
    throw new PortalBookingError('SLOT_UNAVAILABLE', 'Horário indisponível. Escolha outro.');
  }

  const chosenStaffId = selectStaffForSlot({
    date: loaded.date,
    timezone: loaded.timezone,
    service: loaded.service,
    staff: loaded.staff,
    slot: startsAt,
    loads: buildLoads(loaded, now),
    now,
    minAdvanceMinutes: loaded.policies.minAdvanceMinutes,
    maxAdvanceMinutes: loaded.policies.maxAdvanceMinutes,
  });
  if (!chosenStaffId) {
    throw new PortalBookingError('SLOT_UNAVAILABLE', 'Horário indisponível. Escolha outro.');
  }

  let hold: CreatedHold;
  try {
    hold = await createHold({
      tenantId: ctx.tenant.id,
      // Nulo no caso normal: o hold nasce anônimo e o cliente entra na
      // confirmação. Com sessão ativa, já entra vinculado desde o hold.
      customerId: customerId ?? null,
      staffId: chosenStaffId,
      serviceId: loaded.service.id,
      startsAt,
      holdSessionId,
      now,
    });
  } catch (error) {
    if (isSlotUnavailableError(error)) {
      throw new PortalBookingError('SLOT_UNAVAILABLE', 'O horário acabou de ser reservado. Escolha outro.');
    }
    if (error instanceof HoldError && error.code === 'SERVICE_NOT_FOUND') {
      throw new PortalBookingError('SERVICE_NOT_FOUND', error.message);
    }
    throw error;
  }

  const staffName = loaded.names[chosenStaffId] ?? 'Profissional';
  return holdInfo(hold, loaded, staffName, params.authenticated);
}

export interface ConfirmHoldParams {
  ctx: TenantContext;
  holdId: string;
  holdSessionId: string;
  /** `TenantMember.id` do cliente autenticado que está confirmando. */
  memberId: string;
  now?: Date;
}

/**
 * Confirma o hold do dispositivo. IDEMPOTENTE por contrato (item da F3.3):
 * um clique duplo com conexão ruim não pode mostrar erro para quem já teve
 * sucesso. Se o agendamento já está CONFIRMED **e é do mesmo cliente**, devolve
 * sucesso com o registro existente; confirmação alheia continua sendo erro.
 *
 * O agendamento nasce SEM cliente (hold anônimo) e recebe aqui o `TenantMember`
 * identificado pelo OTP. Um hold VENCIDO ainda confirma se a linha existe: os
 * 10 minutos são a garantia de exclusividade, não um prazo de validade — se a
 * linha está lá, a exclusion constraint manteve o horário bloqueado e recusar
 * puniria o cliente por lentidão. Só quando a linha SUMIU (a limpeza de outro
 * hold a recolheu) é que o horário pode ter sido tomado, e aí volta-se à grade.
 */
export async function confirmCustomerHold(params: ConfirmHoldParams): Promise<ConfirmedInfo> {
  const { ctx, holdId, holdSessionId, memberId } = params;
  const now = params.now ?? new Date();

  if (!holdId) throw new PortalBookingError('INVALID_INPUT', 'Informe o agendamento.');
  if (!memberId) throw new PortalBookingError('UNAUTHENTICATED', 'Entre para confirmar.');

  const booking = await ctx.forTenant((tx) =>
    tx.booking.findFirst({
      where: { id: holdId, tenantId: ctx.tenant.id },
      select: {
        id: true,
        status: true,
        customerId: true,
        holdSessionId: true,
        startsAt: true,
        serviceId: true,
        staffId: true,
      },
    }),
  );
  if (!booking) {
    throw new PortalBookingError('BOOKING_NOT_FOUND', 'Este horário não está mais reservado.');
  }
  // O hold só pode ser usado pelo dispositivo que o criou. Sem isso, um id
  // vazado permitiria confirmar o hold alheio.
  if (booking.holdSessionId && booking.holdSessionId !== holdSessionId) {
    throw new PortalBookingError('CONFLICT', 'Este horário foi reservado em outro dispositivo.');
  }

  if (booking.status === 'CONFIRMED') {
    if (booking.customerId !== memberId) {
      throw new PortalBookingError('CONFLICT', 'Este horário já foi confirmado por outra pessoa.');
    }
    return { hold: await describe(ctx, booking.id, booking.serviceId, booking.staffId, booking.startsAt), alreadyConfirmed: true };
  }

  if (booking.status !== 'HOLD' && booking.status !== 'PENDING') {
    throw new PortalBookingError('CONFLICT', 'Este agendamento não pode mais ser confirmado.');
  }

  // Sem checagem de `holdExpiresAt`: hold vencido com a linha viva ainda está
  // bloqueando o slot pela constraint e confirma normalmente.
  try {
    const result = await confirmBooking({
      tenantId: ctx.tenant.id,
      bookingId: booking.id,
      customerId: memberId,
      now,
    });
    return {
      hold: await describe(ctx, result.booking.id, result.booking.serviceId, result.booking.staffId, result.booking.startsAt),
      alreadyConfirmed: false,
    };
  } catch (error) {
    if (error instanceof ConfirmBookingError && error.code === 'INVALID_STATE') {
      // Corrida de clique duplo: outra requisição confirmou entre a leitura e o
      // confirmBooking. Mesmo cliente vira sucesso idempotente.
      const after = await ctx.forTenant((tx) =>
        tx.booking.findFirst({
          where: { id: booking.id, tenantId: ctx.tenant.id },
          select: { status: true, customerId: true },
        }),
      );
      if (after?.status === 'CONFIRMED' && after.customerId === memberId) {
        return {
          hold: await describe(ctx, booking.id, booking.serviceId, booking.staffId, booking.startsAt),
          alreadyConfirmed: true,
        };
      }
      throw new PortalBookingError('CONFLICT', 'Este horário já foi confirmado.');
    }
    throw error;
  }
}

type BookingWithNames = {
  startsAt: Date;
  service: {
    id: string;
    name: string;
    durationMin: number;
    bufferMin: number;
    priceCents: number;
    paymentMode: 'FULL_PREPAID' | 'DEPOSIT' | 'ON_SITE';
    depositCents: number | null;
    depositPercent: number | null;
  };
  staffName: string;
};

/** Monta o resumo exibido na confirmação/recibo, com nomes legíveis. */
async function describe(
  ctx: TenantContext,
  bookingId: string,
  serviceId: string,
  staffId: string,
  startsAt: Date,
): Promise<HoldInfo> {
  const data: BookingWithNames = await ctx.forTenant(async (tx) => {
    // Consultas SEQUENCIAIS de propósito: o Prisma dispara includes
    // independentes em paralelo na mesma conexão da transação interativa, o que
    // emite o aviso "client.query() when the client is already executing a
    // query" (diagnóstico da F0.2 em lib/tenant/db.ts).
    const service = await tx.service.findFirstOrThrow({
      where: { id: serviceId, tenantId: ctx.tenant.id },
      select: {
        id: true,
        name: true,
        durationMin: true,
        bufferMin: true,
        priceCents: true,
        paymentMode: true,
        depositCents: true,
        depositPercent: true,
      },
    });
    const staff = await tx.staffProfile.findFirstOrThrow({
      where: { id: staffId, tenantId: ctx.tenant.id },
      select: { tenantMember: { select: { user: { select: { name: true } } } } },
    });
    return {
      startsAt,
      service,
      staffName: staff.tenantMember.user.name,
    };
  });

  return {
    holdId: bookingId,
    service: data.service,
    staffName: data.staffName,
    startsAt: data.startsAt.toISOString(),
    // Já confirmado: o contador não é mais exibido, mas o tipo exige o campo.
    expiresAt: data.startsAt.toISOString(),
    startsAtLabel: dateTimeLabel(data.startsAt, ctx.tenant.timezone),
    authenticated: true,
  };
}

/** Hora local do slot — usado nos testes de fuso. */
export { timeLabel };
