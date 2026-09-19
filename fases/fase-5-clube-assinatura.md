# Fase 5 — Clube de assinatura B2C

> **Depende de:** F4 · **Estimativa:** 12,5 dias · **Paralelismo:** nenhum (mexe no núcleo do agendamento).
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), [`fase-4-pagamentos.md`](fase-4-pagamentos.md).

> ⚠️ **Este módulo não está na `spec-executiva.md`.** É requisito confirmado do dono do produto, fora do documento. Não o remova por não encontrá-lo na spec.

## Objetivo

Cada estabelecimento vende seu próprio clube: o cliente assina um plano mensal do salão e ganha créditos de serviço por ciclo. Cobrança recorrente com cartão tokenizado, na subconta do salão, com split para a plataforma — tudo contra `MockPaymentProvider`.

**Diferença crítica em relação ao código antigo:** no MVP anterior a assinatura era da plataforma, global, via Stripe. Agora **pertence ao tenant**: preço, benefícios e recebimento são do salão. Não reaproveite `Subscription`/`SubscriptionBenefit` antigos.

## Escopo

### 1. Planos do tenant

Owner cria planos (`MembershipPlan`): nome, preço em centavos, ciclo, benefícios (`MembershipBenefit`: serviço × quantidade por ciclo), ativo/inativo.

Mudança de preço **não** altera assinatura vigente sem decisão explícita — quem já assinou continua no preço contratado até o dono decidir o contrário.

### 2. Assinar

Cliente assina pelo portal: escolhe plano → tokeniza cartão (`tokenizeCard`) → `createSubscription` na subconta com split.

Restrições reais do provider que o mock já cobra (ver [`arquitetura financeira`](../plano-refatoracao.md) §1.1):
- `remoteIp` é o **IP do dispositivo do pagador**, nunca o do servidor — atrás de proxy/CDN, extraia do header correto e trate o caso de ausência;
- o token de cartão **pertence ao cliente que o originou** e não pode ser reaproveitado para outro cliente;
- split em assinatura é suportado, mas nunca para a carteira de quem cria a cobrança.

### 3. Créditos

`CreditLedger` append-only (`delta`, `reason`, `bookingId`): saldo é a soma, nunca um contador mutável. É o que permite auditar "por que meu crédito sumiu" — dúvida que vai aparecer no piloto.

- Renovação do ciclo credita; **decida e documente** se crédito não usado expira ou acumula (recomendado: expira, com aviso).
- Consumo acontece **na mesma transação** do agendamento — nunca dois créditos para um agendamento, nem crédito debitado sem agendamento.
- Cancelamento do agendamento dentro da política **devolve** o crédito (lançamento novo, não edição do antigo).

### 4. Agendamento com benefício

No fluxo da F3, se houver crédito para o serviço, o checkout da F4 é pulado e o crédito é consumido. Sem crédito, cobra normalmente.

**Pendência de produto a confirmar antes de implementar:** cliente do clube ainda paga sinal como garantia contra no-show? Enquanto não houver resposta, implemente sem sinal e deixe a decisão isolada atrás de uma flag de política do tenant.

### 5. Ciclo de vida

Renovação, falha de cobrança (retentativa e suspensão graciosa), cancelamento pelo cliente e pelo dono, e o que acontece com os créditos do ciclo corrente ao cancelar. Tudo por webhook, idempotente.

### 6. Visões

Cliente: plano, saldo de créditos, próxima cobrança, cancelar. Owner: assinantes, MRR do clube, inadimplentes, consumo por serviço.

## Fora do escopo

Mensalidade B2B (F7), integração real (F8).

## Critérios de aceite

1. Assinar → renovar → consumir crédito → cancelar, de ponta a ponta com o mock.
2. Teste de concorrência: dois agendamentos simultâneos com **um** crédito → um passa, um falha.
3. Cancelar agendamento devolve o crédito, e o ledger conta a história inteira.
4. Falha de cobrança suspende conforme política, sem apagar histórico.
5. Cobrança do clube nasce na subconta do salão, com split — teste que falha se sair da conta da plataforma.
6. Assinante do tenant A é invisível no painel do tenant B.
7. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Saldo como contador.** `UPDATE ... SET remaining = remaining - 1` fora de transação com o agendamento gera crédito fantasma. Ledger + transação única.
- **`remoteIp` do servidor.** Passa no mock permissivo, é recusado pelo provider real. O nosso mock recusa de propósito.
- **Cartão de teste em produção.** Tokens de sandbox não valem em produção; a F8 refaz a tokenização.

---

## Tarefas

**F5.2 entra na transação de agendamento pelo ponto de extensão que a F3.2 entregou** (`lib/booking/participants/`, ver `fase-3-portal-booking.md` §3.1): você deixa o seu próprio arquivo na pasta, não edita a transação. O débito de crédito precisa ser atômico com o agendamento, então é participante de transação, não evento pós-commit.

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F5.0** ⟨T0⟩ | Planos e benefícios do tenant: modelo, CRUD do owner, regra de preço travado para quem já assinou | `app/(dashboard)/painel/clube/planos/**`, `app/(dashboard)/painel/clube/page.tsx`, `lib/membership/plans.ts` | F4 | 2,5 |
| **F5.1** | Assinatura: tokenização de cartão, criação na subconta com split, renovação, falha de cobrança, cancelamento, webhooks | `lib/membership/subscription.ts` | F5.0 | 4 |
| **F5.2** | `CreditLedger` append-only e consumo transacional no agendamento, com devolução no cancelamento | `lib/membership/credits.ts` + ponto de integração em `lib/booking/` | F5.0 | 3,5 |
| **F5.3** | Visões: cliente (plano, saldo, próxima cobrança) e owner (assinantes, MRR, inadimplentes, consumo) | `app/[slug]/clube/**`, `app/(dashboard)/painel/clube/relatorios/**` | F5.1, F5.2 | 2,5 |
