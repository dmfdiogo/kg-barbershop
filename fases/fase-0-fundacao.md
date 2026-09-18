# Fase 0 — Fundação

> **Depende de:** nada · **Estimativa:** 10 dias · **Paralelismo:** nenhum. Esta fase define o schema e os contratos de que todas as outras dependem.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), [`../spec-executiva.md`](../spec-executiva.md), [`../plano-refatoracao.md`](../plano-refatoracao.md).

## Objetivo

Deixar o repositório pronto para que as fases seguintes rodem **em paralelo sem colidir**: esqueleto Next.js, schema completo, isolamento por tenant funcionando, contratos dos providers definidos com mocks, seed rico e CI.

Nenhuma tela de produto é entregue aqui. Se ao final existir um painel bonito e o teste de isolamento não existir, a fase falhou.

## Escopo

### 1. Remoção do legado

Antes de apagar, **porte** para `lib/booking/availability.ts`:

- o algoritmo de geração de slots de `backend/src/controllers/appointmentController.ts` → `getAvailability` (duração + buffer + intervalos + agendamentos existentes), **corrigindo o cálculo de fuso** (ver `contexto-comum.md` §3.2);
- a regra de 24h de `rescheduleAppointment`, agora como política configurável (`Tenant.cancellationWindowHours`).

E para `components/`: `DatePickerModal`, `TimePickerModal`, `CalendarView`, `SelectionModal`, `ConfirmationModal`, `PageHeader`, `PageLayout` — trocando toda cor literal por token de tema.

Depois remova: `backend/`, `frontend/`, `backend/tests/*.hurl`, os dois `railway.toml`. Reescreva `docker-compose.yml` para subir Postgres com `btree_gist`.

**Corrija o `.gitignore`:** hoje ele ignora `backend/prisma/migrations/**/migration.sql`. Migration não versionada quebra deploy. Remova a regra.

### 2. Esqueleto Next.js

Estrutura de `../plano-refatoracao.md` §3. Grupos de rota `(platform)`, `(dashboard)`, `[slug]` criados com placeholder — quem os preenche são F7, F2 e F3.

### 3. Schema completo

Implemente **todas** as entidades de `../plano-refatoracao.md` §4, inclusive as que só serão usadas nas fases 5, 6 e 7. Esta é a razão de a F0 existir sozinha: fases paralelas não podem estar criando migrations concorrentes.

### 4. Isolamento (o coração da fase)

- `lib/tenant/db.ts`: client Prisma estendido que abre transação e executa `SET LOCAL app.current_tenant` antes das queries; e `asPlatformAdmin()` explícito para o Super Admin.
- RLS ligada em todas as tabelas com `tenantId`, com policies por `current_setting('app.current_tenant')`.
- Teste que prova que o tenant A não lê nem escreve dado do tenant B — inclusive tentando pelo caminho "esperto" (join, `findMany` sem where, update por id de outro tenant).

### 5. Anti double-booking

Migration com SQL cru (Prisma não gera isso):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
  ) WHERE (status IN ('HOLD','PENDING','CONFIRMED'));
```

`blocked_until` = fim do atendimento + buffer do serviço, para que o intervalo entre atendimentos seja garantido pelo banco. Entregue com teste de concorrência: **duas transações simultâneas** tentando o mesmo slot, uma tem de falhar.

### 6. Ports e mocks

`lib/messaging` e `lib/payments` conforme `contexto-comum.md` §5: interfaces, mocks com as validações do §5.1, disparo de webhook do §5.2, console `/dev/*` do §5.3 e a suíte de contrato do §5.4.

Assinaturas mínimas:

```ts
interface WhatsAppProvider {
  sendOtp(to: E164, code: string): Promise<{ providerMessageId: string }>
  sendTemplate(to: E164, template: TemplateName, vars: Record<string, string>): Promise<{ providerMessageId: string }>
}

interface PaymentProvider {
  createMerchantAccount(i: NewMerchant): Promise<{ accountId: string; walletId: string; kycStatus: KycStatus }>
  getMerchantAccount(accountId: string): Promise<MerchantAccount>
  getBalance(accountId: string): Promise<{ availableCents: number; pendingCents: number }>
  createCharge(i: NewCharge): Promise<Charge>          // Pix ou cartão, com split opcional
  refund(chargeId: string, amountCents: number): Promise<Refund>
  createSubscription(i: NewSubscription): Promise<Subscription>
  cancelSubscription(subscriptionId: string): Promise<void>
  tokenizeCard(i: NewCardToken): Promise<{ token: string }>
}
```

### 7. Seed

Um tenant completo e realista: owner, 3 profissionais com jornadas diferentes (incluindo um que folga na segunda e um com almoço), 5 serviços com durações/buffers/modalidades de cobrança distintas, 20 clientes, agendamentos passados e futuros, um plano de clube com assinante ativo. **Mais um segundo tenant**, para que qualquer fase consiga testar isolamento sem montar dado na mão.

### 8. CI

GitHub Actions: `typecheck`, `lint`, `test` (com Postgres em service container), `build`. PR que quebra não passa.

### 9. `CLAUDE.md`

Na raiz, curto: como rodar, como testar, e os invariantes de `contexto-comum.md` §3 e §4 resumidos. É o que orienta agentes futuros que não leram esta pasta.

## Fora do escopo

Qualquer tela de produto, autenticação real (F1), integração real com provider (F8).

## Critérios de aceite

1. `docker compose up` + `npm run db:reset` + `npm run dev` funciona em máquina limpa, com seed aplicado.
2. Teste de isolamento entre tenants passa e **falha** se a policy de RLS for removida (prove desativando-a temporariamente).
3. Teste de concorrência de slot passa.
4. Suíte de contrato dos providers roda verde contra o mock.
5. `/dev/outbox` mostra um OTP e `/dev/payments` confirma uma cobrança disparando webhook de verdade.
6. `backend/` e `frontend/` não existem mais; nada em `lib/` importa deles.
7. DoD de `contexto-comum.md` §8 cumprido.

## Armadilhas conhecidas

- **`SET LOCAL` só vale dentro de transação.** Fora dela, silenciosamente não faz nada e a RLS vira bloqueio total ou vazamento, dependendo da policy. Teste isso explicitamente.
- **Prisma não conhece exclusion constraints.** A violação chega como erro cru do Postgres (`23P01`); trate e traduza para um erro de domínio, senão a F3 vai devolver 500 para "horário ocupado".
- **Fuso.** Grade gerada em UTC quebra em UTC-3 para horários após 21h. Teste com um agendamento às 22h de Brasília.

---

## Tarefas

Ver [`paralelizacao.md`](paralelizacao.md) §4 e §5. **F0.1 roda sozinha**; depois F0.2, F0.3 e F0.4 vão em paralelo.

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F0.1** ⟨T0⟩ | Esqueleto Next.js, TS strict, Tailwind, Vitest/Playwright, `docker-compose` com `btree_gist`, correção do `.gitignore` das migrations, CI | raiz do repo, `.github/`, `app/layout.tsx`, rotas placeholder | — | 1,5 |
| **F0.2** | Schema completo, migrations, RLS, client escopado, exclusion constraint, teste de isolamento e de concorrência | `prisma/**`, `lib/tenant/**` | F0.1 | 3 |
| **F0.3** | Ports, mocks com validações reais, disparo de webhook, console `/dev`, suíte de contrato | `lib/payments/**`, `lib/messaging/**`, `app/dev/**` | F0.1 | 2,5 |
| **F0.4** | Portar `availability` (com correção de fuso) e componentes de UI; remover `backend/`, `frontend/`, `.hurl`, `railway.toml` | `lib/booking/availability.ts`, `components/**`, remoções | F0.1 | 2 |
| **F0.5** | Seed de dois tenants completos + `CLAUDE.md` | `prisma/seed.ts`, `CLAUDE.md` | F0.2, F0.4 | 1 |
