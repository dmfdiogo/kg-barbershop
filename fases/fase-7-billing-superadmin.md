# Fase 7 — Assinatura B2B e painel da plataforma

> **Depende de:** F2 · **Estimativa:** 10 dias · **Paralelismo:** pode rodar junto com F4 e F6.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), spec §2.1, §3.1 e §6.

## Objetivo

A plataforma cobra dos estabelecimentos e se administra: planos Solo/Equipe/Pro, trial por valor entregue e painel do Super Admin. Contra `MockBillingProvider` — o Stripe real entra na F8.

> A `spec-executiva.md` descreve este módulo mas **não o orçou** no roadmap. Ele é escopo de MVP.

## Escopo

### 1. Planos (spec §6.1)

| Plano | Preço | Limites |
| :--- | :--- | :--- |
| Solo | R$ 39,90/mês | 1 agenda |
| Equipe | R$ 79,90/mês | até 4 agendas, branding |
| Pro | R$ 139,90/mês | agendas ilimitadas, domínio próprio |

Preços e limites em configuração, não espalhados pelo código. O *enforcement* de limite é servidor — esconder o botão no front não é limite.

Ao ultrapassar (ex.: 5º profissional no Equipe), ofereça upgrade com o impacto claro. Ao fazer downgrade com uso acima do limite, exija a decisão de quem desativar antes de aplicar.

### 2. Trial por valor: 10 agendamentos (spec §6.2)

Contador por tenant, incrementado na **confirmação** do agendamento (não na criação do hold — senão hold abandonado consome trial).

- 8º agendamento: aviso amigável no painel convidando a escolher o plano.
- 11º: bloqueia **novos agendamentos**, preservando acesso ao que já existe. Nunca derrube a agenda de um salão em funcionamento; a spec pede "suspensão graciosa".

Documente a decisão: agendamento cancelado descontou trial? (recomendado: não descontar cancelados pelo salão; descontar os concluídos).

### 3. Ciclo de cobrança

Assinar, trocar de plano com proração, atualizar meio de pagamento, cancelar, e inadimplência: retentativa → aviso → suspensão graciosa → reativação. Tudo por webhook idempotente (`contexto-comum.md` §6).

`BillingProvider` é um port como os outros. **Nota:** o Stripe é a integração mais fácil de virar real (test mode com conta instantânea, sem KYC nem aprovação de terceiros), então provavelmente é a primeira que a F8 liga.

### 4. Painel do Super Admin

Lista de tenants com status, plano, uso e saúde da conta de recebimento; MRR, churn, tenants em trial e conversão; acesso ao contexto de um tenant para suporte — **sempre via `asPlatformAdmin()` e sempre registrado em `AuditLog`**. Ninguém olha dado de cliente de salão sem deixar rastro.

## Fora do escopo

Conta Stripe real e chaves (F8), emissão de NFS-e (pendência de produto), módulo de comissões (Fase 2 do produto).

## Critérios de aceite

1. Assinar → trocar plano → inadimplir → suspender → reativar, com o mock.
2. 10 agendamentos disparam o gate; o 8º avisa; o bloqueio não apaga nem esconde o que já existe.
3. Limite de agendas por plano é respeitado no servidor.
4. Acesso do Super Admin a dado de tenant aparece no `AuditLog`.
5. Owner comum não acessa nenhuma rota de `(platform)`.
6. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Trial consumido por hold.** Conte na confirmação.
- **Bloqueio total do inadimplente.** Derrubar a agenda inteira perde o cliente e cria problema para o consumidor final. Bloqueie o novo, preserve o existente.
- **Limite só no front.** Chamada direta à API fura.

---

## Tarefas

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F7.0** ⟨T0⟩ | Planos, limites e enforcement no servidor; upgrade e downgrade com decisão explícita | `lib/billing/{plans,limits}.ts` | F2 | 2,5 |
| **F7.1** | Trial por 10 agendamentos: contador na confirmação, aviso no 8º, bloqueio gracioso no 11º | `lib/billing/trial.ts` | F7.0 | 2 |
| **F7.2** | Ciclo de cobrança contra mock: assinar, trocar com proração, inadimplência, suspensão, reativação, webhooks | `lib/billing/subscription.ts`, `app/api/webhooks/billing/**` | F7.0 | 3,5 |
| **F7.3** | Painel do Super Admin: tenants, MRR, churn, conversão de trial, acesso de suporte auditado | `app/(platform)/**` | F7.0 | 3 |
