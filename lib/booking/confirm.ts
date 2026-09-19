import type { Booking, BookingStatus } from '@prisma/client';
import { forTenant, type TenantTransaction } from '@/lib/tenant/db';

/**
 * Confirmação do agendamento e os DOIS pontos de extensão da F3.2
 * (item 3.1 de `fases/fase-3-portal-booking.md`).
 *
 * Três tarefas futuras reagem à confirmação — débito de crédito do clube
 * (F5.2), contador de trial (F7.1) e lembretes (F6.1). Se cada uma editasse a
 * transação de confirmação, três agentes disputariam o mesmo arquivo. Aqui elas
 * entram por um de dois contratos, deixando o próprio arquivo em
 * `lib/booking/participants/`:
 *
 *   1. PARTICIPANTE DE TRANSAÇÃO — `export const participant`. Roda DENTRO da
 *      transação de confirmação, com acesso ao `TenantTransaction`. É para
 *      efeito que precisa ser atômico com o agendamento (crédito e trial).
 *      Um participante que lança ABORTA a confirmação inteira.
 *
 *   2. HANDLER PÓS-COMMIT — `onBookingConfirmed` / `onBookingCancelled` /
 *      `onBookingRescheduled`. Roda DEPOIS do commit, com o evento já ocorrido.
 *      É para efeito que NÃO pode derrubar o agendamento (WhatsApp fora do ar
 *      não pode impedir alguém de marcar horário). A falha de um handler é
 *      isolada e registrada; não propaga e não impede os demais.
 *
 * DESCOBERTA POR CONVENÇÃO, SEM ARQUIVO-LISTA: cada módulo `.ts` da pasta
 * `lib/booking/participants/` é descoberto por `import.meta.glob` — ninguém
 * precisa acrescentar uma linha em lugar nenhum. Só adicione o arquivo.
 *
 * REENTRÂNCIA (contrato obrigatório, `contexto-comum.md` §4): a callback do
 * client escopado pode rodar DUAS VEZES, porque um write conflict sob disputa
 * de slot (P2034) reexecuta a transação inteira. Consequência para quem escreve
 * um participante: TUDO o que ele fizer precisa ser reexecutável e viver no
 * banco. Nada de chamada externa, escrita em store de mock, envio de mensagem
 * ou incremento em memória — o retry desfaz o que estava no banco e repete;
 * o que estava fora dele duplica. Efeito que não pode acontecer duas vezes vai
 * no handler pós-commit, que só roda depois de a transação ter vencido.
 */

// ---------------------------------------------------------------------------
// Eventos de domínio
// ---------------------------------------------------------------------------

export type BookingEventType = 'BookingConfirmed' | 'BookingCancelled' | 'BookingRescheduled';

export interface BookingEventBase {
  readonly type: BookingEventType;
  readonly tenantId: string;
  readonly bookingId: string;
  /** Instante do commit (UTC). */
  readonly occurredAt: Date;
}

export interface BookingConfirmedEvent extends BookingEventBase {
  readonly type: 'BookingConfirmed';
  readonly customerId: string;
  readonly staffId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly priceCents: number;
  readonly previousStatus: 'HOLD' | 'PENDING';
}

export interface BookingCancelledEvent extends BookingEventBase {
  readonly type: 'BookingCancelled';
  readonly customerId: string;
  readonly staffId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** `User.id` de quem cancelou; `null` quando foi o sistema. */
  readonly cancelledBy: string | null;
  readonly reason: string | null;
}

export interface BookingRescheduledEvent extends BookingEventBase {
  readonly type: 'BookingRescheduled';
  readonly customerId: string;
  readonly serviceId: string;
  readonly previousStaffId: string;
  readonly previousStartsAt: Date;
  readonly previousEndsAt: Date;
  readonly staffId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type BookingDomainEvent =
  | BookingConfirmedEvent
  | BookingCancelledEvent
  | BookingRescheduledEvent;

export type BookingEventHandler<E extends BookingDomainEvent = BookingDomainEvent> = (
  event: E,
) => Promise<void> | void;

// ---------------------------------------------------------------------------
// Participantes de transação
// ---------------------------------------------------------------------------

/** Tudo que um participante precisa para reagir à confirmação, sem consultar de novo. */
export interface BookingConfirmationContext {
  readonly tenantId: string;
  readonly bookingId: string;
  readonly customerId: string;
  readonly staffId: string;
  readonly serviceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly priceCents: number;
  readonly confirmedAt: Date;
  readonly previousStatus: BookingStatus;
}

/**
 * Um participante recebe a transação JÁ aberta e escopada no tenant. Ele não
 * abre transação própria: faz parte da confirmação.
 */
export type BookingParticipant = (
  tx: TenantTransaction,
  context: BookingConfirmationContext,
) => Promise<void>;

// ---------------------------------------------------------------------------
// Descoberta dos módulos da pasta
// ---------------------------------------------------------------------------

/**
 * Forma de um módulo da pasta. Todos os campos são opcionais: um módulo pode
 * ser só participante, só handler de um evento, ou ambos.
 */
export interface BookingParticipantModule {
  participant?: BookingParticipant;
  onBookingConfirmed?: BookingEventHandler<BookingConfirmedEvent>;
  onBookingCancelled?: BookingEventHandler<BookingCancelledEvent>;
  onBookingRescheduled?: BookingEventHandler<BookingRescheduledEvent>;
}

const EVENT_HANDLER_EXPORT = {
  BookingConfirmed: 'onBookingConfirmed',
  BookingCancelled: 'onBookingCancelled',
  BookingRescheduled: 'onBookingRescheduled',
} as const;

// `eager: true` resolve os módulos no build (Turbopack no Next, Vite no Vitest),
// então a pasta é varrida em tempo de compilação — funciona empacotado, sem
// depender de ler o sistema de arquivos em runtime. A ordem é alfabética pelo
// caminho do módulo, o que torna a execução determinística.
const participantModules = import.meta.glob('./participants/*.ts', {
  eager: true,
}) as Record<string, unknown>;

function discoveredModules(): BookingParticipantModule[] {
  return Object.keys(participantModules)
    .sort()
    .map((file) => participantModules[file])
    .filter(
      (module): module is BookingParticipantModule =>
        typeof module === 'object' && module !== null,
    );
}

function asFunction<T>(value: unknown): T | null {
  return typeof value === 'function' ? (value as T) : null;
}

/** Participantes de transação descobertos na pasta, em ordem determinística. */
export function discoverParticipants(): BookingParticipant[] {
  return discoveredModules()
    .map((module) => asFunction<BookingParticipant>(module.participant))
    .filter((participant): participant is BookingParticipant => participant !== null);
}

function discoveredHandlersFor(type: BookingEventType): BookingEventHandler[] {
  const key = EVENT_HANDLER_EXPORT[type];
  return discoveredModules()
    .map((module) => asFunction<BookingEventHandler>(module[key]))
    .filter((handler): handler is BookingEventHandler => handler !== null);
}

// ---------------------------------------------------------------------------
// Erros de confirmação
// ---------------------------------------------------------------------------

export type ConfirmBookingErrorCode = 'INVALID_INPUT' | 'BOOKING_NOT_FOUND' | 'INVALID_STATE';

export class ConfirmBookingError extends Error {
  readonly code: ConfirmBookingErrorCode;
  readonly status: number;

  constructor(code: ConfirmBookingErrorCode, message: string) {
    super(message);
    this.name = 'ConfirmBookingError';
    this.code = code;
    this.status = code === 'BOOKING_NOT_FOUND' ? 404 : code === 'INVALID_STATE' ? 409 : 400;
  }
}

// ---------------------------------------------------------------------------
// Execução dos participantes
// ---------------------------------------------------------------------------

/**
 * Executa os participantes DENTRO de uma transação. Exportada para permitir que
 * outras fases a reusem e testem o próprio participante com injeção explícita.
 *
 * Um participante que lança interrompe a sequência: a transação do chamador
 * aborta, e é exatamente o comportamento desejado (confirmação tudo-ou-nada).
 */
export async function runParticipants(
  tx: TenantTransaction,
  context: BookingConfirmationContext,
  participants: BookingParticipant[] = discoverParticipants(),
): Promise<void> {
  for (const participant of participants) {
    await participant(tx, context);
  }
}

// ---------------------------------------------------------------------------
// Emissão pós-commit
// ---------------------------------------------------------------------------

/**
 * Emite um evento de domínio para os handlers descobertos (ou injetados, em
 * teste). Roda DEPOIS do commit e nunca lança: a falha de um handler é
 * registrada e os demais seguem. Um lembrete que não saiu não pode desconfirmar
 * um agendamento já gravado.
 *
 * Handlers que precisam de banco abrem a própria transação escopada com
 * `forTenant(event.tenantId, ...)`.
 */
export async function emitBookingEvent<E extends BookingDomainEvent>(
  event: E,
  handlers: BookingEventHandler<E>[] = discoveredHandlersFor(event.type) as BookingEventHandler<E>[],
): Promise<void> {
  for (const handler of handlers) {
    try {
      await handler(event);
    } catch (error) {
      console.error(
        `[booking:events] handler de ${event.type} falhou (booking ${event.bookingId}); ignorado por ser pós-commit.`,
        error,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Confirmação
// ---------------------------------------------------------------------------

export interface ConfirmBookingInput {
  tenantId: string;
  bookingId: string;
  /**
   * Cliente identificado pelo OTP. Obrigatório quando o hold nasceu anônimo,
   * que é o caso normal do portal: o soft lock vem antes da identificação. Para
   * um agendamento que já tem cliente (walk-in criado pelo painel), pode ser
   * omitido — nesse caso o cliente existente é preservado.
   */
  customerId?: string;
  /** Injetável para teste; padrão: participantes descobertos na pasta. */
  participants?: BookingParticipant[];
  /** Injetável para teste; padrão: handlers descobertos na pasta. */
  handlers?: BookingEventHandler<BookingConfirmedEvent>[];
  /** Injetável para teste; padrão `new Date()`. */
  now?: Date;
}

export interface ConfirmBookingResult {
  booking: Booking;
  /** Status anterior (HOLD ou PENDING), útil para o clube distinguir a origem. */
  previousStatus: BookingStatus;
  confirmedAt: Date;
}

/**
 * Confirma um hold/pending: muda para CONFIRMED, roda os participantes dentro
 * da transação e só então emite `BookingConfirmed` pós-commit.
 *
 * Só HOLD e PENDING confirmam. HOLD vencido ainda confirma se a linha existe —
 * o cliente que voltou dentro do fluxo não perde a reserva; quem libera o
 * vencido é a criação de hold seguinte e o cron.
 */
export async function confirmBooking(input: ConfirmBookingInput): Promise<ConfirmBookingResult> {
  if (!input.tenantId) throw new ConfirmBookingError('INVALID_INPUT', 'tenantId é obrigatório.');
  if (!input.bookingId) throw new ConfirmBookingError('INVALID_INPUT', 'bookingId é obrigatório.');

  const now = input.now ?? new Date();
  const participants = input.participants ?? discoverParticipants();

  const outcome = await forTenant(input.tenantId, (tx) =>
    confirmBookingInTransaction(tx, {
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      customerId: input.customerId,
      now,
      participants,
    }),
  );

  const event: BookingConfirmedEvent = {
    type: 'BookingConfirmed',
    tenantId: outcome.booking.tenantId,
    bookingId: outcome.booking.id,
    occurredAt: now,
    customerId: outcome.booking.customerId ?? '',
    staffId: outcome.booking.staffId,
    serviceId: outcome.booking.serviceId,
    startsAt: outcome.booking.startsAt,
    endsAt: outcome.booking.endsAt,
    priceCents: outcome.booking.priceCents,
    previousStatus: outcome.previousStatus as 'HOLD' | 'PENDING',
  };

  await emitBookingEvent(event, input.handlers);

  return {
    booking: outcome.booking,
    previousStatus: outcome.previousStatus,
    confirmedAt: now,
  };
}

export interface ConfirmBookingInTransactionInput {
  tenantId: string;
  bookingId: string;
  customerId?: string;
  now: Date;
  /** Participantes já resolvidos pelo chamador (descobertos ou injetados). */
  participants: BookingParticipant[];
}

/**
 * Núcleo da confirmação, SEM abrir transação e SEM emitir evento: o chamador
 * entrega a transação já aberta e é dono do pós-commit.
 *
 * Existe pelo mesmo motivo do `createHoldInTransaction`: a remarcação da F3.4
 * precisa liberar o antigo e confirmar o novo NA MESMA transação, reusando a
 * confirmação (inclusive os participantes atômicos), sem reimplementá-la. Quem
 * abre a transação e emite `BookingConfirmed` é `confirmBooking`.
 */
export async function confirmBookingInTransaction(
  tx: TenantTransaction,
  input: ConfirmBookingInTransactionInput,
): Promise<{ booking: Booking; previousStatus: BookingStatus }> {
  const booking = await tx.booking.findFirst({
    where: { id: input.bookingId, tenantId: input.tenantId },
  });
  if (!booking) {
    throw new ConfirmBookingError('BOOKING_NOT_FOUND', 'Agendamento não encontrado.');
  }
  if (booking.status !== 'HOLD' && booking.status !== 'PENDING') {
    throw new ConfirmBookingError(
      'INVALID_STATE',
      `Agendamento não pode ser confirmado a partir do status ${booking.status}.`,
    );
  }

  const previousStatus = booking.status;

  const confirmed = await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: 'CONFIRMED',
      confirmedAt: input.now,
      ...(input.customerId ? { customerId: input.customerId } : {}),
    },
  });

  // A constraint `booking_customer_required` garante isto no banco; aqui a
  // checagem existe para estreitar o tipo e para falhar com mensagem de
  // domínio caso alguém confirme um hold anônimo sem informar o cliente.
  if (!confirmed.customerId) {
    throw new ConfirmBookingError(
      'INVALID_STATE',
      'Confirmação exige cliente identificado: passe customerId ao confirmar um hold anônimo.',
    );
  }

  const context: BookingConfirmationContext = {
    tenantId: confirmed.tenantId,
    bookingId: confirmed.id,
    customerId: confirmed.customerId,
    staffId: confirmed.staffId,
    serviceId: confirmed.serviceId,
    startsAt: confirmed.startsAt,
    endsAt: confirmed.endsAt,
    priceCents: confirmed.priceCents,
    confirmedAt: input.now,
    previousStatus,
  };

  await runParticipants(tx, context, input.participants);

  return { booking: confirmed, previousStatus };
}
