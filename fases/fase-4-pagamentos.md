# Fase 4 — Pagamentos (contra mock)

> **Depende de:** F3 · **Estimativa:** 12,5 dias · **Paralelismo:** pode rodar junto com F6 e F7.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md) §5 e §6, spec §3.2.

## Objetivo

Todo o domínio financeiro B2C — onboarding da subconta, checkout, sinal, split, saldo e extrato — **inteiro, contra `MockPaymentProvider`**. Na F8 troca-se a factory por Asaas e nada mais.

## Escopo

### 1. Onboarding da conta de recebimento

A partir do CPF/CNPJ e chave Pix coletados na F2, `createMerchantAccount` cria a conta e persiste `AsaasAccount` (`accountId`, `walletId`, `apiKeyEnc`, `kycStatus`).

**A chave de API da subconta é criptografada em repouso** (envelope com chave da aplicação). Nunca em texto puro na tabela; se o banco vazar, vaza o dinheiro dos clientes.

Estados de KYC (`PENDING`, `APPROVED`, `REJECTED`) são visíveis no painel, com o que falta fazer. **Caminho degradado obrigatório:** enquanto não aprovado, o salão opera em `ON_SITE` (pagamento no balcão) — nunca fica travado sem conseguir usar o sistema.

### 2. Checkout

As três modalidades da spec §3.2, por serviço:

1. **Integral antecipado** — Pix ou cartão; hold só vira `CONFIRMED` com pagamento aprovado.
2. **Sinal** — valor fixo ou percentual via Pix; o saldo é pago no local.
3. **No local** — confirma sem cobrança.

O checkout acontece **dentro da janela de 10 minutos do hold**. Pix expirado ou cartão recusado devolve o slot. O tempo restante é visível.

### 3. Split

Cobrança criada **na subconta do estabelecimento**, com split levando a taxa para a carteira da plataforma. Essa direção não é detalhe de implementação: é o que sustenta a blindagem fiscal da spec §3.2 — se a cobrança nascer na conta principal e o dinheiro for repassado por transferência, o faturamento dos salões vira receita da empresa de software perante a Receita Federal.

**Escreva um teste que falha se a cobrança for criada fora da subconta.** O mock já rejeita split apontando para a própria carteira; o teste documenta a intenção.

O percentual da taxa é configuração da plataforma, não número mágico no código.

### 4. Máquina de estados e webhooks

> **A rota `app/api/webhooks/payments/route.ts` já existe**, criada na F0.3 em versão mínima (verifica assinatura e despacha para um handler, sem tocar no banco — o schema ainda não existia lá). Você assume a propriedade dela e a evolui: persistência em `WebhookEvent`, idempotência real, transação e máquina de estados.

`Booking.status` × `Payment.status` num único lugar, com transições explícitas e proibidas explícitas. Webhooks conforme `contexto-comum.md` §6: assinatura verificada, idempotência por `WebhookEvent`, processamento transacional, valor sempre confrontado com o registro local.

Cenários a cobrir: pago, recusado, Pix expirado, estorno total, estorno parcial, webhook duplicado, webhook fora de ordem (confirmação chegando depois do estorno).

### 5. Saldo, extrato e estorno

Saldo disponível/a liberar e extrato dentro do painel — o dono **não acessa painel externo** (spec §3.2). Estorno pela política de cancelamento do tenant.

## Fora do escopo

Clube de assinatura (F5), mensalidade da plataforma (F7), qualquer chamada real ao Asaas (F8).

## Critérios de aceite

1. As três modalidades funcionam de ponta a ponta com o mock, incluindo o webhook disparado por `/dev/payments`.
2. Webhook reentregue não credita duas vezes (teste explícito).
3. Cobrança fora da subconta falha no teste.
4. `apiKeyEnc` não é legível no dump do banco.
5. KYC pendente → salão opera em `ON_SITE` sem travar.
6. Pix expirado libera o slot.
7. Suíte de contrato do `PaymentProvider` estendida com o que esta fase passou a usar.
8. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Confiar no valor do payload.** Sempre confronte com o `Payment` local; payload é entrada não confiável.
- **Webhook fora de ordem.** Chegam fora de sequência. Decida por estado final, não por ordem de chegada.
- **Centavos.** Qualquer conversão para float no meio do split gera diferença de R$ 0,01 que ninguém consegue explicar depois.

---

## Tarefas

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F4.0** ⟨T0⟩ | Máquina de estados `Booking` × `Payment` e núcleo de webhook: assinatura, idempotência, transação, fora de ordem | `lib/payments/state.ts`, `app/api/webhooks/payments/**` | F3 | 3 |
| **F4.1** | Conta de recebimento: `createMerchantAccount`, estados de KYC, criptografia da chave em repouso, caminho degradado `ON_SITE` | `lib/payments/merchant.ts`, `app/(dashboard)/financeiro/conta/**` | F4.0 | 3 |
| **F4.2** | Checkout: integral, sinal e no local; Pix e cartão; split na subconta; expiração dentro da janela do hold | `app/[slug]/checkout/**`, `lib/payments/charge.ts` | F4.0 | 4 |
| **F4.3** | Saldo, extrato e estorno dentro do painel | `app/(dashboard)/financeiro/extrato/**`, `app/(dashboard)/financeiro/page.tsx` | F4.0, F4.1 | 2,5 |
