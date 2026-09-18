# Contexto comum a todas as fases

Regras obrigatórias. Um agente que executa uma fase sem seguir isto produz código que outra fase vai ter de desfazer.

---

## 1. O que é este projeto

SaaS multi-tenant de agendamento e pagamento para prestadores de serviço locais (barbearias, salões, petshops, clínicas estéticas, lava-rápidos). Cada estabelecimento é um **tenant** com portal próprio (`/[slug]` e, na fase 2 do produto, domínio próprio), identidade visual própria e recebimento financeiro próprio.

Quatro papéis: **Super Admin** (plataforma), **Owner** (dono do estabelecimento), **Staff** (prestador) e **Customer** (consumidor final).

O escopo completo está em [`../spec-executiva.md`](../spec-executiva.md). Ela vence o código em qualquer divergência.

O repositório contém hoje um MVP antigo, single-tenant, em Express + React/Vite. Ele **está sendo substituído**, não evoluído. Não importe nada de `backend/` ou `frontend/` sem que a sua fase mande explicitamente portar aquele trecho.

---

## 2. Stack

| Camada | Escolha | Regra |
| :--- | :--- | :--- |
| App | Next.js (App Router) + TypeScript `strict` | Server Components por padrão; `"use client"` só onde há interação. |
| Estilo | Tailwind + CSS variables por tenant | **Nunca** cor literal em componente de produto. Sempre token (`bg-[var(--color-primary)]` ou classe semântica). O white-label depende disso. |

**Duas famílias de token, e só uma é do tenant.** `--color-primary`, `--color-secondary` e `--color-background` são **marca**: o dono customiza (spec §5.1). `--color-success`, `--color-warning` e `--color-danger` (com as variantes `-soft`) são **funcionais** e ficam fixas — vermelho de cancelamento precisa significar cancelamento em todo salão, e deixar o dono pintar isso é como deixá-lo escolher a cor do semáforo. Use-as para status de agendamento e pagamento.
| ORM | Prisma | Sempre pelo client escopado (§4). |
| Banco | PostgreSQL | Extensão `btree_gist` obrigatória. |
| Testes | Vitest (unidade/integração) + Playwright (e2e) | Ver §7. |
| Datas | `date-fns` + `date-fns-tz` | Proibido `moment`. |

Versões instaladas na F0.1: Next 16, React 19, Tailwind 4, Vitest 5, Playwright 1.63, TypeScript 5.9.

⚠️ **ESLint está fixado na linha 9 (9.39.5) de propósito.** O `eslint-config-next` 16 embute um `eslint-plugin-react` que quebra no ESLint 10 (`context.getFilename is not a function`). Não "atualize" o ESLint para 10 achando que é dívida — só suba quando o `eslint-config-next` suportar.

Nada de nova dependência de peso sem justificar no PR. Se precisar de uma biblioteca para algo que a fase não previu, é sinal de que vale perguntar antes.

---

## 3. Invariantes de dados

1. **Dinheiro é `Int` em centavos.** Nunca `Float`, nunca `Decimal` em campo de valor. É o formato de Asaas e Stripe e evita erro de arredondamento no split.
2. **Tempo é `timestamptz`, sempre UTC no banco.** Toda apresentação e todo cálculo de grade acontece no fuso do tenant (`Tenant.timezone`, padrão `America/Sao_Paulo`). **Proibido** usar `getUTCDay()`/`setUTCHours()` para decidir dia de expediente — esse foi um bug real do código antigo.
3. **Toda tabela de negócio tem `tenantId`.** Sem exceção, mesmo quando "dá para chegar lá por join".
4. **Telefone em E.164** (`+5548999999999`). É a chave de identidade do cliente.
5. **IDs de entidade expostos em URL são `cuid`**, não inteiros sequenciais — não queremos enumeração de agendamentos de outro salão.

---

## 4. Isolamento entre tenants

A diretriz §9.3 da spec (dados de um salão nunca visíveis para outro) é implementada em **duas camadas, e as duas são obrigatórias**:

1. **Aplicação:** todo acesso passa pelo client escopado (`lib/tenant/db.ts`), que abre transação e executa `SET LOCAL app.current_tenant = $tenantId` antes das queries. Nunca importe `PrismaClient` cru em código de produto.
2. **Banco:** RLS ligada em todas as tabelas com `tenantId`, com policy comparando `current_setting('app.current_tenant')`.

A camada 1 é a que o dia a dia usa; a camada 2 é a que pega o erro humano. Remover qualquer uma delas "porque a outra já cobre" é regressão de segurança.

Consultas do Super Admin usam um caminho explícito e auditado (`lib/tenant/db.ts` → `asPlatformAdmin()`), nunca o bypass silencioso da RLS.

---

## 5. Ports e mocks — a regra central desta etapa do projeto

WhatsApp, Asaas e Stripe **não serão integrados de verdade agora**. Todo o produto é construído contra interfaces, com implementação mock selecionada por variável de ambiente.

```
lib/messaging/
  types.ts          # interface WhatsAppProvider
  mock.ts           # MockWhatsAppProvider   (usado em F1..F7)
  cloud-api.ts      # implementação real     (só na F8)
  index.ts          # factory por env: MESSAGING_PROVIDER=mock|cloud-api

lib/payments/
  types.ts          # interface PaymentProvider
  mock.ts           # MockPaymentProvider    (usado em F4..F7)
  asaas.ts          # implementação real     (só na F8)
  index.ts          # factory por env: PAYMENT_PROVIDER=mock|asaas
```

**Nenhum código de produto importa `asaas.ts`, `cloud-api.ts` ou o SDK do Stripe diretamente.** Só a factory conhece as implementações. Se uma fase precisar de um dado que a interface não expõe, a interface é estendida (e o mock junto) — não se contorna por fora.

### 5.1. O mock reprova o que o real reprovaria

Um mock permissivo esconde bugs que só aparecem na integração. Os mocks **validam as mesmas regras do serviço real e lançam erro quando violadas**:

- **Pagamentos:** rejeita split apontando para a carteira de quem cria a cobrança (regra real do Asaas); exige `remoteIp` do pagador em cobrança de cartão e **rejeita IP privado/de servidor**; rejeita valor em reais com casas decimais; rejeita cobrança em subconta com KYC não aprovado.
- **Mensageria:** rejeita envio de mensagem que não seja um template previamente registrado na lista de templates aprovados; rejeita número fora de E.164.

### 5.2. O mock exercita o caminho assíncrono

Pagamento real é assíncrono e chega por webhook. O mock **não** marca o pagamento como pago de forma síncrona: ele agenda e **dispara uma requisição real ao próprio endpoint de webhook da aplicação**, com payload no formato do provider e assinatura válida. Assim a máquina de estados é a mesma no mock e em produção.

### 5.3. O estado do mock não mora no schema

O mock guarda o que inventa (cobranças, assinaturas, contas, mensagens) em **store próprio** sob `lib/payments/` e `lib/messaging/` — memória ou arquivo —, **nunca em tabela do schema de domínio**.

Duas razões: a F0.3 roda em paralelo com a F0.2 e não pode depender de um schema que ainda não existe; e dados falsos de provider não pertencem às tabelas do negócio, que são a fonte de verdade do que realmente aconteceu. Quem persiste `Payment` e `WebhookEvent` é o código de produto, ao processar o webhook — não o mock ao fingir que cobrou.

### 5.4. Console de desenvolvimento

Rota `/dev/*`, **bloqueada fora de ambiente de desenvolvimento** (checar `NODE_ENV` no servidor, não só esconder o link):

- `/dev/outbox` — mensagens "enviadas" pelo mock de WhatsApp, com o código OTP visível (é assim que se testa o login).
- `/dev/payments` — cobranças e assinaturas do mock, com botões: confirmar pagamento, recusar, expirar Pix, aprovar/reprovar KYC, simular estorno. Cada botão dispara o webhook correspondente.

### 5.5. Testes de contrato

Existe uma suíte que roda **contra qualquer implementação do port**, parametrizada:

```ts
describe.each(providers)('PaymentProvider: %s', (provider) => { /* ... */ })
```

Hoje ela roda só com o mock. Na F8 o sandbox real entra na mesma lista, e é isso que prova que a troca não quebra nada. Toda fase que estender um port **estende também os testes de contrato**.

---

## 6. Webhooks

Toda entrada de webhook, de qualquer provider (inclusive mock):

1. Verifica assinatura/token antes de qualquer coisa.
2. Grava em `WebhookEvent` com `unique(provider, eventId)`. Evento repetido → `200 OK` sem reprocessar. Providers reentregam; sem isso, cobramos duas vezes ou creditamos duas vezes.
3. Processa dentro de transação.
4. Nunca confia no valor vindo do payload sem confrontar com o registro local.

---

## 7. Testes

Cada fase entrega testes; não é opcional e não é "se der tempo".

- **Unidade:** regras de domínio puras (cálculo de grade, política de cancelamento, consumo de crédito do clube).
- **Integração:** rotas e webhooks contra banco real (Postgres em container, não SQLite — precisamos de RLS e `btree_gist`).
- **Isolamento:** toda fase que adiciona entidade com `tenantId` adiciona um teste que prova que o tenant A não lê nem escreve dado do tenant B. Este teste é obrigatório e não pode ser pulado.
- **E2E:** o fluxo principal da fase, em Playwright. O CI roda e2e em job separado (`npm run test:e2e`), depois de `build`.

---

## 8. Definition of Done (checklist de toda fase)

- [ ] `npm run typecheck` e `npm run lint` limpos.
- [ ] `npm run test` verde, incluindo o teste de isolamento entre tenants.
- [ ] Migrations versionadas e commitadas (`prisma/migrations/**/migration.sql` **não** pode estar no `.gitignore`).
- [ ] Seed atualizado se a fase criou entidade nova.
- [ ] Nenhum segredo commitado; `.env.example` atualizado com as variáveis novas.
- [ ] Nenhuma cor literal em componente de produto.
- [ ] Nenhum import direto de SDK de provider fora de `lib/payments/` e `lib/messaging/`.
- [ ] README da fase atualizado com o que ficou fora do escopo e por quê.
- [ ] Interface em **pt-BR**; código, nomes e commits em inglês.

---

## 9. Limites do agente autônomo

**Faça** o que está no escopo da sua fase, inteiro, incluindo os testes.

**Pare e pergunte** quando:
- precisar alterar o schema fora do que a sua fase declara (o schema é concentrado na F0 justamente para permitir fases em paralelo);
- precisar mudar a assinatura de um port (outras fases dependem dela);
- encontrar contradição entre a spec e o plano;
- a fase depender de credencial, conta externa ou aprovação humana (isso é F8, por definição).

**Não faça:** integração real com serviço externo, chamada de rede a API de terceiro, `git push`, abertura de PR sem pedido, nem "aproveitar que estou aqui" para refatorar código de outra fase.
