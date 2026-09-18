# Plano de Refatoração — de "app de barbearia" para SaaS multi-tenant

> **Base:** [spec-executiva.md](spec-executiva.md) (Rodada 3, 17/09/2026)
> **Status do código atual:** MVP monolítico single-tenant, ~6,5k linhas, **nunca esteve em produção**
> **Estratégia aprovada:** reescrita big-bang no mesmo repositório, migrando para Next.js

---

## 1. Decisões desta rodada

| # | Decisão | Motivo |
| :--- | :--- | :--- |
| D1 | **Next.js (App Router) fullstack**, TypeScript ponta a ponta | O portal do tenant precisa de SSR: injeção de CSS variables por estabelecimento sem *flash* de tema errado, SEO/LCP no mobile e roteamento por domínio próprio no middleware. Com SPA Vite, os três viram gambiarra. |
| D2 | **Reescrita big-bang**, mesmo repo, histórico git preservado | Multi-tenancy, autenticação e modelo financeiro mudam *todas* as tabelas e *todas* as queries. Migrar incrementalmente custaria mais que reescrever, e não há dado em produção para preservar. |
| D3 | **Clube de assinatura B2C permanece no escopo** (não está na spec — entra como módulo novo) | Requisito do produto. Implementação: **Asaas Assinaturas** com cartão tokenizado, criadas na **subconta do estabelecimento**, com `split` para a plataforma. |
| D4 | Documentação legada excluída | `questionnaire.md`, `MANUAL_TESTING_GUIDE.md`, `DEPLOYMENT.md`, `frontend/README.md` — todos contradizem a spec. A spec é a única fonte de verdade agora. |
| D5 | **Mock primeiro, integração depois.** WhatsApp, Asaas e Stripe ficam atrás de interfaces com implementação mock; as integrações reais são uma fase única no fim (F8) | Aprovação do Meta Business, KYC de subconta e criação de contas dependem de ação humana com prazo imprevisível. Construir contra mocks tira essas esperas do caminho crítico e permite entregar quase todo o produto sem depender de ninguém. Os mocks validam as mesmas regras do serviço real e disparam os mesmos webhooks — ver `fases/contexto-comum.md` §5. |

### 1.1. Premissa financeira verificada na documentação do Asaas

Antes de fechar D3, confirmei na documentação oficial:

- **Assinatura recorrente com cartão existe** e aceita `creditCardToken` (cartão tokenizado, sem repedir os dados a cada ciclo). Campos obrigatórios: `customer`, `billingType: CREDIT_CARD`, `nextDueDate`, `value`, `cycle` e **`remoteIp` — o IP do dispositivo do pagador, nunca o IP do servidor** (atenção: atrás de proxy/CDN isso precisa vir do header certo).
- **Split funciona em assinaturas**, não só em cobranças avulsas, e aceita `fixedValue` ou `percentualValue`.
- **Restrição relevante:** o split não pode apontar para a `walletId` da própria conta que cria a cobrança. Logo, a cobrança do clube tem de ser criada **pela subconta do salão**, com split para a wallet da plataforma — e não o contrário.
- **Subcontas** suportam KYC via API, chave de API própria por subconta e relatórios consolidados — que é exatamente o "onboarding sem fricção" da spec §3.2.

Fontes: [Assinatura com cartão](https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito) · [Split de pagamentos](https://docs.asaas.com/docs/split-de-pagamentos) · [Criação de subcontas](https://docs.asaas.com/docs/criacao-de-subcontas)

---

## 2. Diagnóstico: o que existe hoje × o que a spec exige

### 2.1. Aproveitável (portar)

| Ativo | Onde | Observação |
| :--- | :--- | :--- |
| Algoritmo de geração de slots (duração + buffer + intervalos + agendamentos existentes) | `backend/src/controllers/appointmentController.ts` → `getAvailability` | Portar **corrigindo o fuso** (ver §5.4). É o pedaço mais valioso do código atual. |
| Regra de 24h para cancelar/remarcar | mesmo arquivo, `rescheduleAppointment` | Vira política configurável por tenant. |
| Componentes de UI mobile-first | `DatePickerModal`, `TimePickerModal`, `CalendarView`, `SelectionModal`, `ConfirmationModal`, `PageHeader`, `PageLayout` | Portar para o novo front trocando cores fixas por tokens de tema. |
| Fluxos de tela já desenhados | `ManageShop`, `AdminServicesView`, `AdminStaffView`, `StaffDashboard`, `BookingPage` | Valem como referência de UX, não como código. |

### 2.2. Descartável

| Ativo | Por quê |
| :--- | :--- |
| `authController` (e-mail + senha + bcrypt) | Substituído por OTP via WhatsApp, passwordless. |
| `paymentController` (Stripe cobrando o serviço do cliente final) | Na spec o serviço é cobrado pelo Asaas, na subconta do salão. Stripe passa a ser só mensalidade B2B. |
| `Subscription` / `SubscriptionBenefit` / `subscriptionService` | O conceito continua (D3), mas o modelo é outro: hoje a assinatura pertence à plataforma e é global; passa a pertencer ao **tenant**, com preço, benefícios e recebimento do próprio salão. Reescrever, não migrar. |
| `GlobalService` (catálogo global de serviços) | Não existe na spec e conflita com o isolamento por tenant. |
| `backend/tests/*.hurl` (574 linhas) | Testam endpoints que deixam de existir. |
| `railway.toml` (backend e frontend), `docker-compose.yml` | Reescritos para a infra nova (§7). |

### 2.3. Lacunas (tudo isto é construção nova)

Multi-tenancy real e isolamento · papel `SUPER_ADMIN` e painel da plataforma · OTP por WhatsApp · integração Asaas (subcontas, Pix, cartão, split, saldo/extrato) · Stripe Billing B2B · trial por 10 agendamentos · soft lock de 10 minutos · white-label (logo, cores, presets) · slug e domínio próprio · automações de WhatsApp (confirmação, D-1, H-2) · clube de assinatura do tenant.

### 2.4. Bugs conhecidos que não podem ser herdados

1. **Double-booking.** `createAppointment` não valida se o horário está livre — o comentário no código admite: *"simplified for MVP"*. Dois clientes podem reservar o mesmo slot. A spec §9.1 exige o oposto.
2. **Migrations não versionadas.** `.gitignore:45` ignora `backend/prisma/migrations/**/migration.sql`, enquanto o guia de deploy mandava rodar `prisma migrate deploy`. O deploy nunca funcionaria. **Corrigir no primeiro commit da Fase 0.**
3. **Cálculo de agenda em UTC.** A grade é gerada com `getUTCDay()`/`setUTCHours()`. Em UTC-3, agendamentos após 21h caem no dia seguinte e a jornada do profissional escorrega.
4. **PWA que não existe.** O questionário prometia PWA; não há manifest nem service worker. A spec pede "web app responsivo", então a dívida some por decisão de escopo — mas registre que não há app instalável hoje.

---

## 3. Arquitetura alvo

```
kg-barbershop/
├── app/
│   ├── (platform)/            # Super Admin: tenants, assinaturas B2B, métricas
│   ├── (dashboard)/           # Owner e Staff (RBAC por membership)
│   ├── [slug]/                # Portal público do tenant (SSR, white-label)
│   └── api/
│       ├── webhooks/payments/ # B2C: cobranças, assinaturas do clube, KYC
│       ├── webhooks/billing/  # B2B: mensalidade da plataforma
│       └── cron/              # lembretes D-1/H-2, expiração de holds
├── lib/
│   ├── tenant/                # resolução de tenant + client Prisma com RLS
│   ├── booking/               # slots, holds, políticas (núcleo de domínio)
│   ├── payments/asaas/        # subcontas, cobranças, assinaturas, split
│   ├── payments/stripe/       # billing B2B
│   ├── messaging/             # porta WhatsApp + adaptadores
│   └── auth/                  # OTP, sessão, RBAC
├── prisma/
└── spec-executiva.md, plano-refatoracao.md
```

**Rotas de webhook são nomeadas pelo domínio, não pelo provider** (`payments`, `billing`) — e não `asaas`/`stripe`. Trocar a implementação por variável de ambiente não pode implicar trocar URL: quem verifica assinatura e traduz o payload é o adaptador, atrás do port. Na F8, a URL que se cola no painel do Asaas é essa mesma.

**Resolução de tenant (middleware do Next), nesta ordem:** domínio próprio (`Host` casando com `Tenant.customDomain`) → subdomínio → `/[slug]`. Fase 1 entrega slug; domínio próprio é Fase 2 da spec.

**Mensageria como porta, não como dependência.** `WhatsAppProvider` é uma interface com adaptadores (Cloud API oficial, Z-API, Evolution). Motivo em §8.1: o prazo de aprovação da Meta é o maior risco de cronograma do projeto, e essa interface permite desenvolver e pilotar sem ficar bloqueado.

---

## 4. Modelo de dados proposto

Todas as tabelas de negócio carregam `tenantId`. Valores monetários em **centavos (Int)**, nunca `Decimal`/float — é o formato que Asaas e Stripe usam e elimina erro de arredondamento no split.

```
Tenant            slug(unique), customDomain(unique?), name, document(CPF/CNPJ), timezone,
                  logoUrl, colorPrimary, colorSecondary, colorBackground, themePreset,
                  cancellationWindowHours, status, trialBookingsUsed

User              phone(E.164, unique), name, email?, isSuperAdmin      # identidade global
TenantMember      tenantId, userId, role(OWNER|STAFF|CUSTOMER)          # papel por tenant
StaffProfile      tenantMemberId, bio, active
WorkingHours      staffId, weekday, startTime, endTime
TimeOff           staffId, startsAt, endsAt, reason                     # almoço, folga, bloqueio

Service           tenantId, name, durationMin, bufferMin, priceCents,
                  paymentMode(FULL_PREPAID|DEPOSIT|ON_SITE), depositCents|depositPercent, active
StaffService      staffId, serviceId

Booking           tenantId, customerId, staffId, serviceId,
                  startsAt, endsAt, blockedUntil,                       # blockedUntil = endsAt + buffer
                  status(HOLD|PENDING|CONFIRMED|COMPLETED|CANCELLED|NO_SHOW),
                  holdExpiresAt, priceCents, source(PORTAL|WALK_IN)
Payment           tenantId, bookingId, provider, method(PIX|CARD|CASH),
                  amountCents, platformFeeCents, asaasId, status, paidAt

AsaasAccount      tenantId(unique), asaasAccountId, walletId, apiKeyEnc, pixKey, kycStatus
PlatformSub       tenantId(unique), stripeCustomerId, stripeSubscriptionId,
                  plan(SOLO|EQUIPE|PRO), status, currentPeriodEnd, trialEndedAt

MembershipPlan    tenantId, name, priceCents, cycle, active             # clube do salão (D3)
MembershipBenefit planId, serviceId, quantityPerCycle
Membership        tenantId, customerId, planId, asaasSubscriptionId, status, currentPeriodEnd
CreditLedger      membershipId, serviceId, delta, reason, bookingId?    # saldo = soma; auditável

OtpChallenge      phone, codeHash, expiresAt, attempts, consumedAt
NotificationJob   tenantId, bookingId, template, scheduledFor, sentAt, providerMessageId, status
WebhookEvent      provider, eventId(unique), payload, processedAt       # idempotência
AuditLog          tenantId, actorId, action, entity, entityId, createdAt
```

**Decisão de identidade:** `User` é global (o cliente faz OTP uma vez e reencontra seus agendamentos em qualquer salão), e o acesso a dados é sempre escopado por `tenantId` via `TenantMember` + RLS. Nenhum salão consegue enxergar que aquele telefone existe em outro salão, atendendo §9.3. A alternativa (um registro de cliente por tenant) isola fisicamente, mas obriga o cliente a fazer OTP de novo em cada salão e duplica PII — pior para LGPD, não melhor.

---

## 5. Decisões de engenharia que precisam entrar desde o primeiro dia

### 5.1. Anti double-booking no banco, não na aplicação

A garantia da spec §9.1 não pode depender de `if` em JavaScript. Postgres resolve com *exclusion constraint*:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
  ) WHERE (status IN ('HOLD','PENDING','CONFIRMED'));
```

Prisma não gera isso — vai como SQL cru dentro da migration. O intervalo usa `blocked_until` (fim + buffer), então o buffer entre atendimentos passa a ser garantido pelo banco também.

### 5.2. Soft lock de 10 minutos

O hold é uma linha em `Booking` com `status='HOLD'` e `holdExpiresAt = now() + 10min` — a mesma constraint acima já o protege. Dois cuidados:

- A consulta de disponibilidade ignora holds vencidos (`status='HOLD' AND holdExpiresAt > now()`).
- Antes de inserir, a transação apaga os holds vencidos daquele profissional. Sem isso, um hold abandonado e ainda não coletado bloquearia a constraint. O cron de limpeza é rede de segurança, não o mecanismo principal.

### 5.3. RLS com Prisma

RLS por `app.current_tenant`, com um client estendido que abre transação e executa `SET LOCAL app.current_tenant = $1` antes de cada query. `SET LOCAL` só vale dentro de transação — o que é compatível com PgBouncer em modo transaction. **Em camadas:** o `tenantId` explícito no repositório é a primeira linha de defesa; a RLS é a rede que pega o esquecimento humano. Só RLS é frágil com Prisma; só aplicação é frágil com gente.

### 5.4. Fuso horário

`timestamptz` no banco (sempre UTC), `Tenant.timezone` (`America/Sao_Paulo` como padrão) e toda a montagem de grade feita no fuso do tenant com `date-fns-tz` ou Luxon. Nunca `getUTCDay()` para decidir dia da semana de expediente — é a origem do bug 2.4.3.

### 5.5. Webhooks idempotentes

Asaas e Stripe reentregam eventos. Toda entrada grava em `WebhookEvent` com `unique(provider, eventId)`; evento repetido sai com 200 sem reprocessar. Assinatura sempre verificada (Stripe: header de assinatura; Asaas: token de autenticação configurado no webhook).

### 5.6. Lembretes são trabalhos persistidos

D-1 e H-2 viram linhas em `NotificationJob` criadas na confirmação do agendamento, executadas por cron (a cada 5 min) com janela de tolerância e marcação de envio. `setTimeout` em processo serverless não sobrevive ao deploy.

---

## 6. Fases

O detalhamento executável de cada fase está em [`fases/`](fases/) — um arquivo por fase, autocontido, escrito para ser entregue a um agente autônomo sem depender desta conversa. Comece por [`fases/README.md`](fases/README.md) e [`fases/contexto-comum.md`](fases/contexto-comum.md).

Por D5, tudo de F1 a F7 é construído contra mocks. Nenhuma dessas fases precisa de conta, chave ou aprovação externa.

| Fase | Entrega | Dias | Depende de | Precisa de você? |
| :--- | :--- | :--- | :--- | :--- |
| **F0** | **Fundação.** Remoção do legado (após portar slots e componentes), esqueleto Next.js, schema completo, RLS, exclusion constraint, ports + mocks, console `/dev`, seed, CI, `CLAUDE.md` | 7 | — | não |
| **F1** | **Multi-tenant + auth OTP** (mock de WhatsApp). Middleware de tenant, RBAC por `TenantMember`, OTP com rate limit e defesas | 12 | F0 | não |
| **F2** | **Painel do Owner.** Onboarding guiado, serviços, equipe, jornadas, bloqueios, políticas, white-label | 15 | F1 | não |
| **F3** | **Portal de booking + anti-concorrência.** Grade, hold de 10 min, área do cliente, walk-in | 12 | F1 | não |
| **F4** | **Pagamentos** (mock). Subconta, KYC, checkout Pix/cartão, sinal, split, saldo, extrato, estorno | 12 | F3 | não |
| **F5** | **Clube de assinatura B2C** (mock) *(escopo novo, fora da spec)*. Planos do tenant, cartão tokenizado, ledger de créditos | 12 | F4 | não |
| **F6** | **Notificações** (mock). Jobs persistidos, confirmação, D-1, H-2, cancelamento, opt-out, log de entrega | 8 | F3 | não |
| **F7** | **Billing B2B + Super Admin** (mock) *(a spec não estimou)*. Planos, trial por 10 agendamentos, suspensão graciosa, painel da plataforma | 10 | F2 | não |
| **F8** | **Integrações reais.** Stripe → Asaas → WhatsApp, trocando só a factory | 12 | F5, F6, F7 | **sim** |
| **F9** | **Piloto** com 3 a 5 estabelecimentos reais | 14 | F8 | **sim** |

### 6.1. Paralelização

```
Onda 1   F0                          (sozinha — define schema e contratos)
Onda 2   F1                          (sozinha — sessão e RBAC tocam tudo)
Onda 3   F2  ‖  F3
Onda 4   F4  ‖  F6  ‖  F7
Onda 5   F5
Onda 6   F8  →  F9
```

O que torna o paralelismo possível é o schema inteiro nascer na F0: fases simultâneas nunca criam migrations concorrentes. Uma fase que julgue precisar mexer no schema **para e pergunta**.

**Fase não é tarefa de agente.** As 9 fases se decompõem em **42 tarefas** de 1 a 3 dias, listadas no fim de cada arquivo de fase. O mapa de quantos agentes cabem por onda, quem é dono de quais arquivos e como mesclar está em [`fases/paralelizacao.md`](fases/paralelizacao.md) — com um revisor humano, o recomendado é **3 a 4 agentes simultâneos**, contra um teto de 7 a 9 pelo grafo de dependências.

**Total em série ≈ 114 dias. Caminho crítico ≈ 81 dias** paralelizando no nível de fase (F0 → F1 → F3 → F4 → F5 → F8 → F9), **≈ 58 dias de esforço** paralelizando também dentro das fases — este último supondo agentes suficientes e revisão que não vira fila. O roadmap da spec soma 80 dias em série porque não orçou o módulo Stripe B2B, o painel do Super Admin nem o clube B2C — vale ajustar a spec para não criar expectativa errada.

**Corte possível se precisar antecipar o piloto:** F5 (clube) e F7 (billing B2B) podem ir para depois do primeiro piloto — durante o piloto os estabelecimentos não pagam mensalidade mesmo. Tira ~22 dias do caminho até o primeiro cliente real, sem tocar no núcleo.

## 7. Infraestrutura

| Camada | Escolha | Nota |
| :--- | :--- | :--- |
| App | Vercel | Domínios customizados com SSL automático (§5.2 da spec) sem infra própria. |
| Banco | Postgres gerenciado (Neon ou Supabase) | Precisa suportar `btree_gist` e RLS — ambos suportam. |
| Cron | Vercel Cron → `app/api/cron/*` | Lembretes e expiração de holds. Autenticar o endpoint com secret. |
| Domínio próprio | Vercel Domains (ou Cloudflare for SaaS) | Fase 2 da spec. |
| Segredos | Chave de API de subconta Asaas **criptografada em repouso** (não em texto puro na tabela) | Vaza tudo se o banco vazar. |

---

## 8. Riscos

### 8.1. WhatsApp: saiu do caminho crítico, mas ainda bloqueia o piloto

A Cloud API oficial exige verificação do Meta Business e **aprovação de templates** (o de OTP entra na categoria *authentication*, com regras próprias), o que leva dias a semanas e não depende de código.

Com a decisão D5, isso **deixa de bloquear o desenvolvimento**: F1 a F7 rodam inteiras com `MockWhatsAppProvider`, e o OTP é lido em `/dev/outbox`. O que continua bloqueado é o piloto — sem número aprovado, não há cliente real recebendo código.

**Recomendação:** abrir a verificação e submeter os templates enquanto a F0/F1 acontecem. É espera calendário, não esforço; começar cedo custa uma tarde e pode economizar semanas no fim.

Gateways não oficiais (Z-API/Evolution) seguem como plano B para o piloto, com risco de bloqueio do número — aceitável para 3 a 5 estabelecimentos, não para produção. A porta de mensageria (§3) permite decidir isso no último momento.

### 8.2. Onboarding Asaas

Criação de subconta exige documentação e aprovação de KYC, que pode ser recusada ou ficar pendente. O produto precisa de estados explícitos (`kycStatus`) e de um caminho degradado: o salão opera com "pagamento no local" enquanto a subconta não é aprovada. Sem isso, um cadastro travado vira um salão que não consegue usar o sistema.

### 8.3. Conformidade fiscal

A blindagem descrita na spec §3.2 depende de a cobrança do serviço ser criada **na subconta**, com o split levando só a taxa para a plataforma. Se em algum fluxo a cobrança sair na conta principal e o repasse for feito por transferência, o desenho fiscal do projeto cai por terra. Isso merece um teste automatizado, não só cuidado manual.

### 8.4. LGPD

Telefone é PII e é a chave de identidade do sistema. Exigem decisão explícita antes do piloto: política de retenção, direito de exclusão, criptografia dos tokens Asaas e o `AuditLog` de acesso a dados de cliente.

---

## 9. Pendências de produto

1. **Nome e domínio.** A spec usa `agendex.com.br`; o repositório se chama `kg-barbershop`. Definir o nome antes da F0 (afeta repo, domínio, templates de WhatsApp e conta Stripe).
2. **Taxa da plataforma.** Qual o percentual do split sobre serviços e sobre o clube? Quem absorve a taxa do Asaas — o salão ou o cliente final?
3. **Política de estorno.** Cancelou dentro da janela: o sinal volta integral, parcial ou vira crédito? Quem executa o estorno?
4. **NFS-e da mensalidade.** Automatizar desde o início ou emitir manualmente durante o piloto?
5. **Clube × sinal.** Cliente do clube que agenda serviço coberto pelo benefício: pula o checkout inteiro, ou ainda paga sinal como garantia contra no-show?
