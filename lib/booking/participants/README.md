# Contrato dos pontos de extensão da confirmação (F3.2)

Esta pasta é o ponto de extensão de `lib/booking/confirm.ts` para as fases que
reagem a um agendamento. **Não existe arquivo-lista**: para entrar, basta criar
um arquivo `.ts` aqui. A varredura é feita por `import.meta.glob('./participants/*.ts')`,
no build (Turbopack no Next, Vite no Vitest) — ninguém adiciona linha em lugar
nenhum, e a ordem de execução é alfabética pelo caminho do módulo.

## Os dois contratos

Um módulo pode implementar um, outro, ou os dois.

### 1. Participante de transação — `export const participant`

Roda **dentro** da transação de confirmação, com a transação já escopada no
tenant. Use para o que precisa ser **atômico** com o agendamento:

```ts
import type { TenantTransaction } from '@/lib/tenant/db';
import type { BookingConfirmationContext } from '@/lib/booking/confirm';
import { recordAuditLog } from '@/lib/audit/record';

export async function participant(
  tx: TenantTransaction,
  context: BookingConfirmationContext,
): Promise<void> {
  await recordAuditLog(tx, {
    tenantId: context.tenantId,
    actorId: null,
    action: 'booking.confirmed',
    entity: 'Booking',
    entityId: context.bookingId,
  });
}
```

- Um participante que **lança aborta a confirmação inteira** (a transação não
  commita). É o comportamento desejado para crédito/trial.
- Entram por aqui: débito de crédito do clube (F5.2) e contador de trial
  (F7.1).

### 2. Handler pós-commit — `onBookingConfirmed` / `onBookingCancelled` / `onBookingRescheduled`

Roda **depois** do commit. Use para efeito que **não pode derrubar o
agendamento** (WhatsApp fora do ar não impede alguém de marcar horário):

```ts
import type { BookingConfirmedEvent } from '@/lib/booking/confirm';

export async function onBookingConfirmed(event: BookingConfirmedEvent): Promise<void> {
  // Abra a própria transação escopada; o commit da confirmação já aconteceu.
  // await forTenant(event.tenantId, (tx) => /* cria NotificationJob, etc. */);
}
```

- A falha de um handler é registrada e **isolada**: não propaga, não impede os
  demais handlers e não desfaz o agendamento.
- Entram por aqui: lembretes de WhatsApp (F6.1).

## Regra de reentrância (obrigatória)

**A callback do client escopado pode rodar duas vezes.** Sob disputa de slot o
Postgres devolve `P2034`/`40P01` e `lib/tenant/db.ts` reexecuta a transação
inteira — participantes incluídos. Consequência:

- Todo participante tem de ser **reexecutável** e viver **no banco**. O retry
  desfaz o que estava no banco e repete; o que estava fora dele **duplica**.
- **Proibido** dentro de um participante: chamada a provider externo, escrita em
  store de mock, envio de mensagem, mutação de estado em memória.
- Efeito que não pode acontecer duas vezes vai no **handler pós-commit**, que só
  roda quando a transação vence.

O teste `tests/integration/booking-confirm.test.ts` prova as duas propriedades:
um participante que lança aborta a confirmação, e um participante que escreve no
banco e sofre o retry termina com **um** efeito, não dois.
