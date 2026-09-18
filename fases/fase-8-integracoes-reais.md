# Fase 8 — Integrações reais

> **Depende de:** F5, F6, F7 **e de ações humanas** (§1) · **Estimativa:** 14 dias de código, mas o prazo real é ditado por aprovações de terceiros.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md) §5, [`../plano-refatoracao.md`](../plano-refatoracao.md) §1.1 e §8.

## Objetivo

Trocar os mocks pelas implementações reais **sem alterar uma linha de código de produto**. Se esta fase precisar mexer em regra de negócio, alguma fase anterior furou a arquitetura de ports — corrija lá, não aqui.

A ordem sugerida é do mais fácil para o mais lento: **Stripe → Asaas → WhatsApp**.

## 1. O que só o dono do produto pode fazer (começar cedo)

Estas três tarefas não dependem de código e têm prazo imprevisível. Começar cedo é o que evita ficar com o produto pronto e parado.

| # | Tarefa | Prazo típico | Bloqueia |
| :--- | :--- | :--- | :--- |
| 1 | Criar conta Stripe, ativar cobrança em BRL, pegar chaves de teste | horas | 8.2 |
| 2 | Conta Asaas da plataforma aprovada + acesso à API de subcontas e split (pode exigir liberação comercial) | dias | 8.3 |
| 3 | Verificação do Meta Business + número dedicado + **aprovação dos templates** (OTP é categoria *authentication*, com regras próprias) | dias a semanas | 8.4 |

Definir também, antes da 8.3: **nome e domínio do produto** (a spec usa `agendex.com.br`, o repositório se chama `kg-barbershop`) e o **percentual da taxa da plataforma**.

## 2. Stripe (billing B2B)

`lib/payments/stripe.ts` implementando `BillingProvider`. Produtos e preços dos três planos criados por script versionado, não no painel na mão. Webhook com verificação de assinatura e a mesma idempotência do mock. Rodar a suíte de contrato contra o test mode.

## 3. Asaas (B2C)

`lib/payments/asaas.ts` implementando `PaymentProvider`, primeiro em **sandbox**.

Pontos onde a realidade morde mais que o mock:

- **Subcontas:** KYC assíncrono, com recusa e pendência. Mapeie os status reais para os nossos e teste o caminho degradado (`ON_SITE`) com uma conta reprovada de verdade.
- **Split:** confirme em sandbox que o dinheiro cai onde o desenho fiscal exige — cobrança na subconta, taxa para a plataforma. Não aponte split para a carteira de quem cria a cobrança.
- **`remoteIp`:** em produção, atrás de proxy/CDN, o IP do pagador vem em header específico. Errar aqui só aparece em produção, com cartão recusado.
- **Webhooks:** token de autenticação, reentrega e ordem imprevisível — o que a F4 já tratou, agora com payloads reais.
- **Chaves de subconta:** criptografadas em repouso, com rotação prevista.

**Antes de ir para produção:** cobrança de R$ 1,00 ponta a ponta em conta real, com split, conferida no extrato — Pix e cartão.

## 4. WhatsApp (Cloud API)

`lib/messaging/cloud-api.ts` implementando `WhatsAppProvider`, com os templates aprovados na tarefa 3.

- Os nomes dos templates aprovados têm de bater com o registro central da F6; se a Meta exigir texto diferente, atualize o registro — não improvise texto livre no código.
- Janela de 24h: fora dela, só template. O botão de confirmação do D-1 chega como webhook de resposta e precisa ser tratado.
- Rate limits e qualidade do número: monitore a classificação, ela cai com bloqueio de usuário.
- Fallback definido para falha de entrega (e-mail? SMS? só log?) — decida antes do piloto.

## 5. Corte e observabilidade

- Troca por variável de ambiente (`PAYMENT_PROVIDER`, `MESSAGING_PROVIDER`, `BILLING_PROVIDER`), com rollback para mock em segundos.
- Os mocks **continuam existindo** — são o que faz o CI rodar sem rede e sem gastar dinheiro.
- Logs estruturados, alerta de falha de webhook e de cobrança, e um painel mínimo de saúde das integrações.

## Critérios de aceite

1. Suíte de contrato roda verde contra mock **e** sandbox real, sem ramificação por provider no código de produto.
2. Nenhum arquivo fora de `lib/payments/` e `lib/messaging/` mudou nesta fase (verificável no diff — é o teste da arquitetura).
3. Transação real de R$ 1,00 com split conferida no extrato, Pix e cartão.
4. OTP real entregue em número real, em menos de 30 segundos.
5. D-1 real entregue no horário certo, com o botão de confirmação atualizando o agendamento.
6. Rollback para mock testado.
7. Nenhum segredo no repositório.

## Armadilhas conhecidas

- **Sandbox ≠ produção.** Tokens de cartão, limites e KYC mudam. Reserve tempo para uma segunda rodada de testes já em produção.
- **Diff grande aqui é sintoma.** Se a troca exigir mexer em telas ou regras, o vazamento de abstração está em outra fase.

---

## Tarefas

O paralelismo mais limpo do projeto: três adaptadores, três arquivos, nenhuma interseção. Cada tarefa só começa quando a credencial correspondente da §1 existir.

| ID | Tarefa | Dono dos arquivos | Destrava com | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F8.1** | Adaptador Stripe + script versionado de produtos e preços + webhook real | `lib/payments/stripe.ts`, `scripts/stripe-setup.ts` | conta Stripe (horas) | 3 |
| **F8.2** | Adaptador Asaas: subcontas, KYC real, Pix, cartão, split, webhooks; sandbox e depois produção | `lib/payments/asaas.ts` | conta Asaas aprovada (dias) | 5 |
| **F8.3** | Adaptador WhatsApp Cloud API com os templates aprovados, janela de 24h e webhook de resposta do botão | `lib/messaging/cloud-api.ts` | verificação Meta + templates (semanas) | 4 |
| **F8.4** | Observabilidade, flags de corte por ambiente, rollback para mock testado | `lib/observability/**`, configuração | — | 2 |
