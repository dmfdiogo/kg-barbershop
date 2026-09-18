# Fase 1 — Multi-tenant e autenticação OTP

> **Depende de:** F0 · **Estimativa:** 12 dias · **Paralelismo:** nenhum. Sessão e RBAC atravessam todas as telas.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), [`fase-0-fundacao.md`](fase-0-fundacao.md).

## Objetivo

Resolver *qual tenant* e *quem é o usuário* em toda requisição, com login passwordless por WhatsApp OTP — usando `MockWhatsAppProvider`. Ao final, um cliente entra com nome + telefone e recebe o código em `/dev/outbox`.

## Escopo

### 1. Resolução de tenant (proxy.ts)

Ordem: `Host` casando com `Tenant.customDomain` → subdomínio → `/[slug]`. O tenant resolvido entra no contexto da requisição e alimenta o client escopado da F0. Tenant inexistente, suspenso ou inativo tem página própria — não 404 genérico.

Domínio próprio é Fase 2 do produto: implemente **só a resolução**, sem provisionamento de DNS/SSL.

**O proxy fica fino, e o motivo não é estilo.** Ele roda em **toda** requisição, inclusive as de asset. Se cada uma disparar um `SELECT` para descobrir o tenant, você paga um ida-e-volta de banco no caminho mais quente da aplicação. Faça o `proxy.ts` apenas **extrair** o identificador (host, subdomínio ou primeiro segmento do path) e repassá-lo adiante por header; a resolução de fato — buscar o `Tenant`, checar status, alimentar o client escopado — acontece na camada de Server Component / route handler, onde dá para memoizar por requisição com `cache()` do React.

**Slugs reservados (achado da F0.1).** A rota dinâmica `/[slug]` convive com segmentos estáticos (`/painel`, `/plataforma` e, no futuro, `/api`, `/dev`). O Next resolve o estático primeiro, então funciona — mas um tenant com slug `painel` ficaria inacessível para sempre. Entregue a lista de palavras reservadas e a função de validação; quem consome é a configuração de slug na F2.

### 2. OTP

Fluxo: informa nome + WhatsApp → `OtpChallenge` com **hash** do código (nunca o código em texto puro) → `sendOtp` pelo provider → valida → cria/recupera `User` por telefone → cria `TenantMember` com papel `CUSTOMER` se ainda não existir naquele tenant → sessão.

Defesas obrigatórias, porque é o endpoint mais atacável do produto:
- código de 6 dígitos, TTL de 5 minutos, **uso único**;
- máximo de 5 tentativas por desafio, depois invalida;
- rate limit por telefone **e** por IP (o custo de mensagem é real quando a integração chegar);
- comparação em tempo constante;
- resposta idêntica para telefone existente e inexistente (não vaze a base de clientes de um salão);
- reenvio com cooldown.

### 3. Sessão e RBAC

Sessão em cookie `httpOnly`, `secure`, `sameSite=lax`. O papel **não** mora no token: é lido de `TenantMember` para o tenant da requisição — a mesma pessoa pode ser `OWNER` no salão A e `CUSTOMER` no salão B.

Helpers `requireRole(...)` para Server Components e Route Handlers. Owner e Staff entram pelo mesmo fluxo OTP (sem senha em lugar nenhum do sistema).

### 4. Super Admin

`User.isSuperAdmin` dá acesso a `(platform)`, por caminho auditado (`asPlatformAdmin()`), nunca por bypass implícito de RLS. A tela em si é F7; aqui é só o portão.

## Fora do escopo

Painel do Owner (F2), portal público de agendamento (F3), envio real de WhatsApp (F8), provisionamento de domínio (produto Fase 2).

## Critérios de aceite

1. Login completo de ponta a ponta com o código lido em `/dev/outbox`.
2. Mesma pessoa com papéis diferentes em dois tenants, e cada sessão enxerga só o seu.
3. Testes: código expirado, código errado 5x, reenvio em cooldown, rate limit estourado, código reusado.
4. Teste provando que `OtpChallenge` guarda hash, não o código.
5. Usuário do tenant A não acessa rota do tenant B nem trocando o slug na URL.
6. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Papel em token.** Cacheia o papel e quebra no segundo tenant. Leia do banco por requisição.
- **Enumeração de clientes.** Mensagem diferente para telefone conhecido entrega a base do salão para quem tentar. Resposta e tempo iguais nos dois casos.
- **Rate limit em memória.** Em serverless, não sobrevive. Persista (banco ou Redis).

---

## Tarefas

**F1.0 roda sozinha** e entrega os contratos; as demais compilam contra eles sem se enxergar.

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F1.0** ⟨T0⟩ | Resolução de tenant no proxy, contexto de requisição, tipos de sessão, `requireRole`, assinaturas das server actions de auth | `proxy.ts`, `lib/tenant/context.ts`, `lib/auth/{session,rbac,types}.ts` | F0 | 2,5 |
| **F1.1** | OTP: desafio com hash, TTL, uso único, limite de tentativas, cooldown, rate limit persistente, testes de abuso | `lib/auth/otp.ts`, `app/api/auth/**` | F1.0 | 3 |
| **F1.2** | Telas de identificação: nome + WhatsApp, código, reenvio, erros | `app/(auth)/**` | F1.0 | 2,5 |
| **F1.3** | Provisionamento de `TenantMember` no primeiro acesso e troca de contexto entre tenants | `lib/auth/membership.ts` | F1.0 | 2 |
| **F1.4** | Portão do Super Admin, `asPlatformAdmin()` auditado, base do `AuditLog` | `app/(platform)/layout.tsx`, `lib/audit/**` | F1.0 | 2 |
