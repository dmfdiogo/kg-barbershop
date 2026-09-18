# Prompts para abrir agentes

Um prompt por tarefa, pronto para colar. **Um agente = uma tarefa = um diretório de trabalho = um PR.**

Os prompts estão também em arquivos individuais em [`prompts/`](prompts/) (`F0.1.txt`, `F2.3.txt`, …), para copiar sem caçar no meio deste arquivo.

Antes de disparar:

- Respeite a ordem das ondas ([`paralelizacao.md`](paralelizacao.md) §3). Tarefa de tronco ⟨T0⟩ roda **sozinha** e precisa estar mesclada antes das folhas da mesma fase começarem.
- Não ultrapasse sua capacidade de revisão. Três ou quatro agentes simultâneos com um revisor humano; comece com dois.
- Cada agente recebe a branch e o diretório indicados no próprio prompt.

---

## Usando com agentes externos (DeepSeek e afins)

Estes prompts foram escritos para qualquer agente de código, não só para o Claude Code. Alguns cuidados valem especialmente quando o agente roda fora deste projeto:

**1. Um diretório por agente, sem exceção.** Dois agentes no mesmo checkout se sobrescrevem. Se o harness do agente não lida bem com `git worktree`, use um clone separado por agente:

```bash
git clone . ../wt-f2-1 && cd ../wt-f2-1 && git checkout -b f2.1-servicos
```

O prompt traz o comando de worktree; troque pelo clone se for o caso — o que importa é o isolamento, não o mecanismo.

**2. Orçamento de contexto.** A lista de leitura de cada prompt soma cerca de 15 mil tokens (spec 14 KB, plano 22 KB, contexto-comum 9 KB, paralelização 7 KB, arquivo da fase 5 KB). Cabe folgado em 64k. Se o modelo que você usar tiver janela menor, corte nesta ordem: primeiro `paralelizacao.md` (guarde só §4, a propriedade de arquivos), depois as seções da spec que não são do escopo da tarefa. **Nunca corte `contexto-comum.md`** — é o que impede o agente de inventar convenção própria.

**3. Confirme que ele leu.** Agentes fora de um harness integrado às vezes começam a escrever sem abrir os arquivos. Um bom primeiro turno: *"antes de programar, liste em 5 linhas o que você entendeu do seu escopo e de quais arquivos você é dono."* Se a resposta for genérica, ele não leu.

**4. Ele não tem acesso a nada externo, e isso é proposital.** Nenhuma tarefa de F0 a F7 precisa de conta, chave ou rede. Se um agente pedir credencial de Asaas, Stripe ou Meta antes da F8, ele saiu do escopo.

**5. Idioma.** Os prompts e a documentação estão em pt-BR de propósito: misturar idioma entre o prompt e os documentos que ele precisa ler piora a aderência. Mantenha o código, os nomes e os commits em inglês, como manda `contexto-comum.md` §8.

**6. Revisão é sua.** Nenhum prompt autoriza `push` ou abertura de PR. O agente entrega na branch dele e você revisa com o Definition of Done (`contexto-comum.md` §8) na mão. O relatório final que o prompt exige — arquivos alterados, saída dos testes, o que ficou fora, dúvidas — existe para tornar essa revisão rápida.

**7. Quando o agente travar.** Se ele começar a inventar API ou a reescrever coisa fora do escopo, quase sempre é tarefa grande demais. Pare, quebre a tarefa em duas e recomece — insistir com o mesmo prompt num contexto já poluído raramente melhora.

---

# Onda 1 — Fase 0: Fundação

## F0.1 ⟨T0⟩ — Esqueleto e tooling · roda sozinha

```
Você é o agente da tarefa F0.1 do projeto kg-barbershop, um SaaS multi-tenant de
agendamento e pagamento para prestadores de serviço locais.

LEIA NESTA ORDEM, antes de escrever código:
  1. spec-executiva.md
  2. plano-refatoracao.md
  3. fases/contexto-comum.md      (regras obrigatórias, não sugestões)
  4. fases/paralelizacao.md §4 e §5
  5. fases/fase-0-fundacao.md     (seu escopo: itens 2 e 8; sua linha: F0.1)

AMBIENTE
  git worktree add ../wt-f0-1 -b f0.1-esqueleto
  Trabalhe apenas nessa worktree.

VOCÊ É DONO DE
  raiz do repositório (package.json, tsconfig, tailwind, eslint, vitest, playwright),
  .github/workflows/, app/layout.tsx, app/globals.css, rotas placeholder,
  docker-compose.yml, .gitignore, .env.example

ENTREGUE
  - Next.js App Router com TypeScript strict e Tailwind.
  - Vitest e Playwright configurados e rodando (mesmo que vazios).
  - docker-compose com Postgres e a extensão btree_gist disponível.
  - Grupos de rota (platform), (dashboard) e [slug] criados como placeholder.
  - CI no GitHub Actions: typecheck, lint, test (com Postgres em service container) e build.
  - CORREÇÃO OBRIGATÓRIA: o .gitignore atual ignora
    "backend/prisma/migrations/**/migration.sql". Migration não versionada quebra
    deploy. Remova essa regra.

PRONTO QUANDO
  - npm run dev sobe; typecheck, lint, test e build passam.
  - CI barra um PR que quebra qualquer um deles.
  - docker compose up sobe o Postgres com btree_gist instalável.

NÃO FAÇA
  schema, telas de produto, integração externa, push, PR sem pedido.
  Precisou de arquivo que não é seu: pare e pergunte.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F0.2 — Schema, RLS e anti double-booking

```
Você é o agente da tarefa F0.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md
  2. plano-refatoracao.md  (§4 modelo de dados, §5 decisões de engenharia)
  3. fases/contexto-comum.md      (§3 invariantes, §4 isolamento — obrigatórios)
  4. fases/paralelizacao.md §4 e §5
  5. fases/fase-0-fundacao.md     (seu escopo: itens 3, 4 e 5; sua linha: F0.2)

AMBIENTE
  git worktree add ../wt-f0-2 -b f0.2-schema     (parte de F0.1 já mesclada)

VOCÊ É DONO DE
  prisma/**, lib/tenant/**

JÁ ESTÁ PRONTO PARA VOCÊ (não reinstale, não altere package.json)
  - prisma e @prisma/client 7.10.0 JÁ instalados e fixados. Não rode
    "npm install prisma": o dist-tag latest hoje aponta para uma release
    candidate (8.0.0-rc), e a fundação do projeto não vai em RC.
  - npm audit acusa vulnerabilidades em mysql2, dependência transitiva do CLI do
    Prisma. Projeto é Postgres, o CLI é devDependency e nada disso entra no
    bundle. NÃO rode "npm audit fix --force": ele rebaixa o Prisma para a 6.x.
  - docker compose up -d sobe o Postgres com btree_gist. O init do volume já
    cria a extensão; a sua migration deve criá-la também (CREATE EXTENSION IF
    NOT EXISTS), porque em CI o banco é outro.
  - package.json e package-lock.json são da F0.1. Precisou de dependência nova?
    PARE e peça — três agentes editando o lockfile ao mesmo tempo dá conflito.

ENTREGUE
  - Schema COMPLETO do plano §4 — inclusive tabelas que só as fases 5, 6 e 7 vão
    usar. O schema é congelado depois desta tarefa; é o que permite fases paralelas.
  - Migrations versionadas e commitadas.
  - Client Prisma escopado: abre transação e faz SET LOCAL app.current_tenant antes
    das queries. Mais asPlatformAdmin() explícito para o Super Admin.
  - RLS em todas as tabelas com tenantId, por current_setting('app.current_tenant').
  - Migration com SQL cru: CREATE EXTENSION btree_gist e a exclusion constraint
    booking_no_overlap sobre tstzrange(starts_at, blocked_until) por staff_id,
    restrita a status HOLD/PENDING/CONFIRMED.
  - Tradução do erro 23P01 do Postgres para um erro de domínio (sem isso a F3
    devolve 500 para "horário ocupado").

PRONTO QUANDO
  - Teste de isolamento passa E falha se a policy de RLS for removida (prove).
  - Teste de concorrência: duas transações simultâneas no mesmo slot, uma falha.
  - Dinheiro é Int em centavos e datas são timestamptz em todo o schema.

ATENÇÃO
  SET LOCAL só vale dentro de transação; fora dela falha em silêncio. Teste isso.

NÃO FAÇA
  telas, mocks de provider, integração externa, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F0.3 — Ports, mocks e console /dev

```
Você é o agente da tarefa F0.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. plano-refatoracao.md §1 (decisão D5) e §1.1 (restrições reais do Asaas)
  2. fases/contexto-comum.md §5 e §6   — é a espinha dorsal da sua tarefa
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-0-fundacao.md          (seu escopo: item 6; sua linha: F0.3)

AMBIENTE
  git worktree add ../wt-f0-3 -b f0.3-ports     (parte de F0.1 já mesclada)

VOCÊ É DONO DE
  lib/payments/**, lib/messaging/**, app/dev/**

ATENÇÃO ÀS DEPENDÊNCIAS
  package.json e package-lock.json são da F0.1, e outros dois agentes estão
  trabalhando no mesmo repositório agora. Precisou de biblioteca nova (validação
  de payload, por exemplo)? PARE e peça em vez de instalar — lockfile editado
  por três agentes ao mesmo tempo dá conflito garantido.

CONTEXTO DA DECISÃO
  WhatsApp, Asaas e Stripe NÃO serão integrados agora. Todo o produto é construído
  contra as suas interfaces. Se o seu mock for permissivo, metade do código nasce
  errado e só descobrimos na integração.

ENTREGUE
  - Interfaces WhatsAppProvider e PaymentProvider com as assinaturas de
    fase-0-fundacao.md item 6, e factories por env (mock | real).
  - Mocks que REPROVAM o que o serviço real reprova:
      * split apontando para a carteira de quem cria a cobrança;
      * remoteIp ausente ou de IP privado/servidor em cobrança de cartão;
      * cobrança em subconta com KYC não aprovado;
      * template de WhatsApp não registrado; número fora de E.164.
  - O mock NÃO marca pago de forma síncrona: ele dispara uma requisição real ao
    próprio endpoint de webhook da aplicação, com payload e assinatura válidos.
  - /dev/outbox (mensagens e código OTP) e /dev/payments (confirmar, recusar,
    expirar Pix, aprovar/reprovar KYC, estornar), bloqueados fora de
    desenvolvimento no servidor — não basta esconder o link.
  - Suíte de testes de contrato parametrizada por implementação (describe.each),
    rodando hoje só com o mock. Na F8 o sandbox real entra na mesma lista.

PRONTO QUANDO
  - Contrato verde contra o mock.
  - Botão em /dev/payments dispara webhook que muda o estado de verdade.
  - Cada validação do item 2 acima tem teste que prova a recusa.

NÃO FAÇA
  chamada de rede a serviço externo, SDK real, telas de produto, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F0.4 — Portar domínio e componentes, remover o legado

```
Você é o agente da tarefa F0.4 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. plano-refatoracao.md §2 (o que aproveitar e o que descartar) e §5.4 (fuso)
  2. fases/contexto-comum.md §3
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-0-fundacao.md          (seu escopo: item 1; sua linha: F0.4)

AMBIENTE
  git worktree add ../wt-f0-4 -b f0.4-portar     (parte de F0.1 já mesclada)

VOCÊ É DONO DE
  lib/booking/availability.ts, components/**, e a remoção do código legado

  EXCEÇÃO AUTORIZADA: ao remover backend/ e frontend/, apague também as entradas
  "backend" e "frontend" do "exclude" em tsconfig.json e do "ignores" em
  eslint.config.mjs. Elas existem só para o CI não quebrar enquanto o legado
  ainda está no repo. Esses dois arquivos são da F0.1; você está autorizado a
  mexer NESSAS LINHAS e em mais nada dentro deles.

JÁ ESTÁ PRONTO PARA VOCÊ (não reinstale, não altere package.json)
  - date-fns 4.4.0 e date-fns-tz 3.2.0 JÁ instalados. Use-os para o cálculo no
    fuso do tenant. moment é proibido (contexto-comum.md §2).
  - package.json e package-lock.json são da F0.1, e outros dois agentes estão no
    mesmo repositório agora. Precisou de dependência nova? PARE e peça.

ENTREGUE
  - Portar de backend/src/controllers/appointmentController.ts -> getAvailability o
    algoritmo de geração de slots (duração + buffer + intervalos + agendamentos),
    CORRIGINDO o cálculo de fuso: o código antigo usa getUTCDay()/setUTCHours(),
    o que quebra em UTC-3. Use o timezone do tenant.
  - Portar a regra de 24h de rescheduleAppointment como política configurável
    (Tenant.cancellationWindowHours), não constante.
  - Portar os componentes DatePickerModal, TimePickerModal, CalendarView,
    SelectionModal, ConfirmationModal, PageHeader e PageLayout, trocando TODA cor
    literal por token de tema (o white-label depende disso).
  - Remover: backend/, frontend/, backend/tests/*.hurl, os dois railway.toml.

PRONTO QUANDO
  - Teste com agendamento às 22h de Brasília cai no dia certo.
  - Nenhuma cor literal nos componentes portados.
  - backend/ e frontend/ não existem e nada em lib/ ou app/ importa deles.

NÃO FAÇA
  schema, mocks, telas novas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F0.5 — Seed e CLAUDE.md

```
Você é o agente da tarefa F0.5 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. plano-refatoracao.md §4
  2. fases/contexto-comum.md
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-0-fundacao.md          (seu escopo: itens 7 e 9; sua linha: F0.5)

AMBIENTE
  git worktree add ../wt-f0-5 -b f0.5-seed       (F0.2 e F0.4 já mescladas)

VOCÊ É DONO DE
  prisma/seed.ts, CLAUDE.md

ENTREGUE
  - Tenant A completo e realista: owner, 3 profissionais com jornadas DIFERENTES
    (um que folga na segunda, um com almoço), 5 serviços com durações, buffers e
    modalidades de cobrança distintas, 20 clientes, agendamentos passados e
    futuros, um plano de clube com assinante ativo.
  - Tenant B, mínimo porém funcional, para que QUALQUER fase consiga testar
    isolamento sem montar dado na mão.
  - CLAUDE.md curto na raiz: como rodar, como testar e os invariantes de
    contexto-comum.md §3 e §4 resumidos. É o que orienta agentes que não leram
    a pasta fases/.

PRONTO QUANDO
  - db:reset + seed roda limpo em máquina nova e é idempotente.
  - Os dados batem com o que as fases seguintes precisam para trabalhar sem F2.

NÃO FAÇA
  alterar schema, telas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

---

# Onda 2 — Fase 1: Multi-tenant e autenticação OTP

## F1.0 ⟨T0⟩ — Contratos de tenant e sessão · roda sozinha

```
Você é o agente da tarefa F1.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2 (papéis)
  2. fases/contexto-comum.md §4 (isolamento)
  3. fases/paralelizacao.md §2 (padrão tronco-e-folhas) e §4
  4. fases/fase-1-multitenant-auth.md   (seu escopo: itens 1 e 3; sua linha: F1.0)

AMBIENTE
  git worktree add ../wt-f1-0 -b f1.0-contratos     (F0 inteira mesclada)

VOCÊ É DONO DE
  middleware.ts, lib/tenant/context.ts, lib/auth/session.ts, lib/auth/rbac.ts,
  lib/auth/types.ts

VOCÊ É O TRONCO DESTA FASE
  F1.1, F1.2, F1.3 e F1.4 vão compilar contra o que você entregar, sem se enxergar.
  Entregue os contratos ANTES de qualquer implementação profunda: tipos de sessão,
  assinaturas das server actions de auth (mesmo que como stub tipado) e helpers.

ENTREGUE
  - Middleware resolvendo o tenant nesta ordem: Host casando com Tenant.customDomain,
    depois subdomínio, depois /[slug]. Só a RESOLUÇÃO — provisionamento de DNS/SSL
    é fase 2 do produto.
  - Páginas próprias para tenant inexistente, suspenso ou inativo (não 404 genérico).
  - Contexto de requisição alimentando o client escopado da F0.
  - Sessão em cookie httpOnly, secure, sameSite=lax.
  - requireRole(...) para Server Components e Route Handlers.
  - REGRA CRÍTICA: o papel NÃO mora no token. É lido de TenantMember para o tenant
    da requisição — a mesma pessoa pode ser OWNER no salão A e CUSTOMER no salão B.

PRONTO QUANDO
  - As três formas de resolução de tenant têm teste.
  - requireRole nega corretamente em RSC e em route handler.
  - Um agente conseguiria implementar F1.1 e F1.2 lendo só os seus contratos.

NÃO FAÇA
  OTP (é F1.1), telas (F1.2), envio real de mensagem, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F1.1 — OTP: núcleo e defesas

```
Você é o agente da tarefa F1.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.4 (autenticação sem fricção)
  2. fases/contexto-comum.md §5 (você usa o MockWhatsAppProvider)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-1-multitenant-auth.md   (seu escopo: item 2; sua linha: F1.1)

AMBIENTE
  git worktree add ../wt-f1-1 -b f1.1-otp          (F1.0 já mesclada)

VOCÊ É DONO DE
  lib/auth/otp.ts, app/api/auth/**

CONTEXTO
  Este é o endpoint mais atacável do produto: é anônimo, gera custo por mensagem
  quando a integração real chegar e dá acesso à conta. Trate as defesas como parte
  do escopo, não como extra.

ENTREGUE
  - Desafio com HASH do código (nunca o código em texto puro no banco), 6 dígitos,
    TTL de 5 minutos, uso único.
  - Máximo de 5 tentativas por desafio, depois invalida.
  - Cooldown de reenvio.
  - Rate limit por telefone E por IP, PERSISTENTE (em serverless, contador em
    memória não sobrevive).
  - Comparação em tempo constante.
  - Resposta e tempo IDÊNTICOS para telefone conhecido e desconhecido — resposta
    diferente entrega a base de clientes do salão para quem tentar.
  - Envio pelo WhatsAppProvider (mock); o código aparece em /dev/outbox.

PRONTO QUANDO
  - Testes de: código expirado, errado 5 vezes, reusado, reenvio em cooldown,
    rate limit estourado.
  - Teste provando que o banco não guarda o código legível.
  - Teste de não-enumeração (resposta e tempo iguais).

NÃO FAÇA
  telas (F1.2), integração real, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F1.2 — Telas de identificação

```
Você é o agente da tarefa F1.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.4
  2. fases/contexto-comum.md §2 (nada de cor literal) e §5.3 (/dev/outbox)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-1-multitenant-auth.md   (sua linha: F1.2)

AMBIENTE
  git worktree add ../wt-f1-2 -b f1.2-telas-auth    (F1.0 já mesclada)

VOCÊ É DONO DE
  app/(auth)/**

ENTREGUE
  - Tela de identificação: apenas Nome + WhatsApp. Sem senha em lugar nenhum do
    sistema.
  - Tela de código com reenvio, contador e mensagens de erro claras (código
    expirado, errado, tentativas esgotadas).
  - Mobile-first de verdade: funciona a 360px de largura.
  - Consome as server actions definidas pela F1.0; se a assinatura não bastar,
    PARE e peça — não crie a sua.

PRONTO QUANDO
  - E2E: login completo lendo o código em /dev/outbox.
  - Nenhuma cor literal; tudo por token de tema.

NÃO FAÇA
  lógica de OTP (é F1.1), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F1.3 — Provisionamento de membro e troca de contexto

```
Você é o agente da tarefa F1.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. plano-refatoracao.md §4 ("Decisão de identidade")
  2. fases/contexto-comum.md §4
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-1-multitenant-auth.md   (sua linha: F1.3)

AMBIENTE
  git worktree add ../wt-f1-3 -b f1.3-membership     (F1.0 já mesclada)

VOCÊ É DONO DE
  lib/auth/membership.ts

CONTEXTO DA MODELAGEM
  User é global (a pessoa faz OTP uma vez e reencontra seus agendamentos em
  qualquer salão), e o acesso a dados é sempre escopado por tenantId via
  TenantMember. Nenhum salão pode descobrir que aquele telefone existe em outro.

ENTREGUE
  - Provisionamento automático de TenantMember com papel CUSTOMER no primeiro
    acesso da pessoa ao portal daquele tenant.
  - Troca de contexto quando a mesma pessoa tem papéis em tenants diferentes.
  - Papel sempre lido por requisição, nunca cacheado no token.

PRONTO QUANDO
  - Teste com a mesma pessoa OWNER no tenant A e CUSTOMER no tenant B: cada sessão
    enxerga só o seu papel e só os seus dados.
  - Teste provando que o tenant A não consegue descobrir a existência do usuário
    no tenant B.

NÃO FAÇA
  telas, OTP, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F1.4 — Portão do Super Admin e auditoria

```
Você é o agente da tarefa F1.4 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.1
  2. fases/contexto-comum.md §4 (caminho do Super Admin)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-1-multitenant-auth.md   (seu escopo: item 4; sua linha: F1.4)

AMBIENTE
  git worktree add ../wt-f1-4 -b f1.4-superadmin     (F1.0 já mesclada)

VOCÊ É DONO DE
  app/(platform)/layout.tsx, lib/audit/**

ENTREGUE
  - Portão de acesso a (platform) por User.isSuperAdmin.
  - Acesso a dado de tenant SEMPRE por asPlatformAdmin(), nunca por bypass
    implícito de RLS.
  - Modelo e escrita de AuditLog: quem, o quê, qual entidade, quando.

PRONTO QUANDO
  - Owner comum não acessa nenhuma rota de (platform).
  - Todo acesso da plataforma a dado de tenant gera registro em AuditLog — com
    teste que prova.

NÃO FAÇA
  as telas do painel da plataforma (isso é F7.3), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

---

# Onda 3 — Fases 2 e 3, em paralelo

F2.0 e F3.0 são troncos e podem rodar ao mesmo tempo (não se tocam). Depois, até 4 folhas simultâneas.

## F2.0 ⟨T0⟩ — Shell do painel · roda sozinha na F2

```
Você é o agente da tarefa F2.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.2 e §2.3
  2. fases/contexto-comum.md §2
  3. fases/paralelizacao.md §2 (tronco-e-folhas) e §4.1 (evite arquivos-lista)
  4. fases/fase-2-painel-owner.md    (sua linha: F2.0)

AMBIENTE
  git worktree add ../wt-f2-0 -b f2.0-shell        (F1 inteira mesclada)

VOCÊ É DONO DE
  app/(dashboard)/layout.tsx, components/dashboard/**

VOCÊ É O TRONCO
  Quatro folhas (F2.1 a F2.4) vão construir dentro do seu shell em paralelo.
  O maior risco de conflito entre elas é um ARQUIVO-LISTA central de navegação
  onde cada uma acrescenta uma linha.

ENTREGUE
  - Shell do painel mobile-first (Owner e Staff), com navegação montada por
    DESCOBERTA: cada feature exporta o seu item em app/(dashboard)/<feature>/nav.ts
    e o menu é montado varrendo a pasta. Nada de lista central.
  - Navegação sensível ao papel: Staff não vê as telas de configuração.
  - Estados padronizados de vazio, carregando e erro, reutilizáveis pelas folhas.
  - Tokens de tema aplicados (sem cor literal).

PRONTO QUANDO
  - Uma rota placeholder nova aparece no menu sem editar nenhum arquivo central.
  - Staff e Owner veem menus diferentes, com teste.

NÃO FAÇA
  features (serviços, equipe, marca, políticas são das folhas), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F2.1 — Serviços

```
Você é o agente da tarefa F2.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.2 (catálogo de serviços)
  2. fases/contexto-comum.md §3 (dinheiro em centavos) e §7 (testes)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-2-painel-owner.md    (seu escopo: item 2; sua linha: F2.1)

AMBIENTE
  git worktree add ../wt-f2-1 -b f2.1-servicos      (F2.0 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/servicos/**, lib/catalog/**

ENTREGUE
  - CRUD de serviço: nome, duração, buffer entre atendimentos, preço em CENTAVOS,
    modalidade de cobrança (FULL_PREPAID | DEPOSIT | ON_SITE), valor ou percentual
    do sinal, profissionais habilitados, ativo/inativo.
  - Serviço com agendamento futuro NÃO é excluído — é desativado. Ofereça isso em
    vez de apagar.
  - Item de menu em app/(dashboard)/servicos/nav.ts (padrão da F2.0).

PRONTO QUANDO
  - Tentar excluir serviço com agendamento futuro oferece desativar, com teste.
  - Nenhum valor monetário passa por float em nenhum ponto.
  - Teste de isolamento: owner do tenant A não lê nem edita serviço do tenant B.

NÃO FAÇA
  alterar schema, mexer no shell, cobrar de verdade, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F2.2 — Equipe, jornadas e bloqueios

```
Você é o agente da tarefa F2.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.2 e §2.3
  2. fases/contexto-comum.md §3 (fuso do tenant)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-2-painel-owner.md    (seu escopo: item 3; sua linha: F2.2)

AMBIENTE
  git worktree add ../wt-f2-2 -b f2.2-equipe        (F2.0 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/equipe/**, lib/staffing/**

ENTREGUE
  - Convite de membro por telefone; ele vira TenantMember com papel STAFF e entra
    pelo mesmo OTP dos clientes (não existe senha no sistema).
  - Jornada semanal por profissional, no fuso do tenant.
  - Bloqueios pontuais: almoço, folga, emergência.
  - Vínculo profissional x serviços.
  - VALIDAÇÃO OBRIGATÓRIA: reduzir jornada ou criar bloqueio sobre agendamento
    existente NÃO pode apagar o agendamento em silêncio. Liste os conflitos e
    obrigue uma decisão explícita.

PRONTO QUANDO
  - Teste: reduzir jornada com agendamento no intervalo apresenta os conflitos e
    exige decisão; nenhum agendamento desaparece.
  - Teste de isolamento entre tenants.

NÃO FAÇA
  alterar schema, mexer na grade de disponibilidade (é F3.1), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F2.3 — White-label

```
Você é o agente da tarefa F2.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §5.1 (os 4 presets, com as paletas)
  2. fases/contexto-comum.md §2 (tokens, nunca cor literal)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-2-painel-owner.md    (seu escopo: item 5; sua linha: F2.3)

AMBIENTE
  git worktree add ../wt-f2-3 -b f2.3-marca         (F2.0 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/marca/**, lib/theme/**

ENTREGUE
  - Upload de logo (PNG/JPG/SVG) com limite de tamanho e validação do tipo pelo
    CONTEÚDO, não pela extensão. SVG aceita script: sanitize ou sirva com CSP
    adequada.
  - Cores primária, secundária e de fundo.
  - Os 4 presets da spec: Classic Barber, Beauty & Spa, Pet Friendly, Auto Detail.
  - Preview ao vivo.
  - Injeção das cores como CSS variables no SSR do portal — é o que evita o flash
    de tema errado.
  - Validação de contraste: o dono pode escolher amarelo sobre branco e tornar o
    próprio portal ilegível. Avise antes de salvar.

PRONTO QUANDO
  - Trocar o preset muda o portal público sem flash — verificado no HTML do SSR,
    não só a olho.
  - SVG com script não executa, com teste.
  - Combinação de baixo contraste dispara aviso.

NÃO FAÇA
  alterar schema, mexer no portal além da injeção de tema, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F2.4 — Políticas e dashboard operacional

```
Você é o agente da tarefa F2.4 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.2 (dashboard) e §9 (políticas)
  2. fases/contexto-comum.md §3
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-2-painel-owner.md    (seu escopo: itens 4 e 6; sua linha: F2.4)

AMBIENTE
  git worktree add ../wt-f2-4 -b f2.4-politicas     (F2.0 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/configuracoes/**, app/(dashboard)/inicio/**

ENTREGUE
  - Políticas do tenant: janela de cancelamento (padrão 24h), política de no-show,
    antecedência mínima e máxima para agendar. Persistidas e legíveis pelo domínio
    (a regra de 24h foi portada como política configurável na F0.4, não constante).
  - Dashboard: faturamento do dia e do mês, taxa de ocupação por profissional,
    agenda do dia. Enquanto a F4 não existe, faturamento vem dos Booking
    confirmados.

PRONTO QUANDO
  - Alterar a janela de cancelamento muda o comportamento lido pelo domínio.
  - Os números batem com o seed da F0.5, com teste.

NÃO FAÇA
  alterar schema, pagamentos, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F2.5 — Onboarding guiado · depois de F2.1, F2.2 e F2.3

```
Você é o agente da tarefa F2.5 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §9.2 (menos de 10 minutos) e §3.2 (onboarding financeiro)
  2. fases/contexto-comum.md
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-2-painel-owner.md    (seu escopo: item 1; sua linha: F2.5)

AMBIENTE
  git worktree add ../wt-f2-5 -b f2.5-onboarding    (F2.1, F2.2 e F2.3 mescladas)

VOCÊ É DONO DE
  app/(dashboard)/onboarding/**

ENTREGUE
  - Passo a passo curto: dados do estabelecimento -> horário de expediente ->
    primeiro serviço -> link do portal pronto para colar no WhatsApp.
  - Estado salvo a CADA passo: o dono vai abandonar no meio e voltar.
  - Coleta de CPF/CNPJ e chave Pix, persistidos, com estado "aguardando ativação".
    A criação da subconta é da F4 — aqui é só coleta.
  - REUSE as server actions de F2.1, F2.2 e F2.3. Não duplique formulário nem regra.

PRONTO QUANDO
  - E2E cronometrado: do zero ao link do portal em menos de 10 minutos.
  - Abandonar no meio e voltar retoma exatamente onde parou, com teste.

NÃO FAÇA
  criar subconta de verdade, duplicar lógica das folhas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.0 ⟨T0⟩ — Portal público · roda sozinha na F3

```
Você é o agente da tarefa F3.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.4 e §5
  2. fases/contexto-comum.md §2 e §4
  3. fases/paralelizacao.md §2 e §4
  4. fases/fase-3-portal-booking.md    (seu escopo: item 1; sua linha: F3.0)

AMBIENTE
  git worktree add ../wt-f3-0 -b f3.0-portal        (F1 inteira mesclada)

VOCÊ É DONO DE
  app/[slug]/(portal)/**, components/portal/**

VOCÊ É O TRONCO DA F3
  F3.1 a F3.5 constroem sobre o seu shell. Entregue contratos e layout cedo.

ENTREGUE
  - Portal público em /[slug], renderizado no SERVIDOR com o tema do tenant já
    aplicado (CSS variables no HTML do SSR — sem flash).
  - Catálogo de serviços com duração e preço.
  - Shell mobile-first: o público-alvo abre isso no celular, por link de WhatsApp.
  - Páginas para tenant inexistente, suspenso ou inativo.

PRONTO QUANDO
  - O tema aparece no HTML servido, verificável sem JavaScript.
  - Funciona a 360px.
  - Nenhuma resposta de API do portal expõe dado de outro tenant, com teste.

NÃO FAÇA
  grade de horários (F3.1), hold (F3.2), fluxo de agendamento (F3.3),
  push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.1 — Grade de disponibilidade

```
Você é o agente da tarefa F3.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. plano-refatoracao.md §5.4 (fuso) e §2.4 (bugs que não podem ser herdados)
  2. fases/contexto-comum.md §3
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-3-portal-booking.md    (seu escopo: item 2; sua linha: F3.1)

AMBIENTE
  git worktree add ../wt-f3-1 -b f3.1-grade         (F3.0 já mesclada)

VOCÊ É DONO DE
  lib/booking/availability.ts    (portado e corrigido na F0.4 — evolua a partir dele)

ENTREGUE
  - Grade considerando: jornada do profissional, bloqueios, buffer do serviço,
    agendamentos existentes, antecedência mínima e máxima do tenant.
  - Holds vigentes ocupam; holds VENCIDOS nunca aparecem como ocupados
    (status HOLD e holdExpiresAt > now()).
  - "Qualquer profissional": une as grades e, na confirmação, escolhe distribuindo
    carga — não sempre o primeiro da lista.
  - Tudo calculado no fuso do tenant. Proibido getUTCDay()/setUTCHours().

PRONTO QUANDO
  - Teste de fuso: agendamento às 22h de Brasília cai no dia certo.
  - Testes de buffer, de bloqueio e de hold vencido.
  - Teste provando que "qualquer um" não concentra tudo no mesmo profissional.

NÃO FAÇA
  criar hold (é F3.2), UI (F3.3), alterar schema, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.2 — Hold de 10 minutos

```
Você é o agente da tarefa F3.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §9.1 (garantia anti-concorrência)
  2. plano-refatoracao.md §5.1 e §5.2
  3. fases/contexto-comum.md §3 e §7
  4. fases/fase-3-portal-booking.md    (seu escopo: item 3; sua linha: F3.2)

AMBIENTE
  git worktree add ../wt-f3-2 -b f3.2-hold          (F3.0 já mesclada)

VOCÊ É DONO DE
  lib/booking/hold.ts, app/api/cron/expire-holds/**

CONTEXTO
  A garantia contra double-booking é a exclusion constraint criada na F0.2, não um
  if em JavaScript. O código antigo do projeto NÃO validava disponibilidade
  ("simplified for MVP", no próprio comentário) e permitia reserva dupla. Aqui isso
  é resolvido no banco.

ENTREGUE
  - Criação de hold com status HOLD e holdExpiresAt = now() + 10min.
  - A MESMA transação apaga, antes de inserir, os holds vencidos daquele
    profissional. Sem isso um hold abandonado e ainda não coletado bloqueia a
    constraint e o horário fica preso.
  - O cron de expiração é rede de segurança, não o mecanismo principal. Endpoint
    autenticado por secret.
  - Violação da constraint (erro 23P01) vira erro de domínio "horário acabou de ser
    reservado" — NUNCA 500.
  - Amarre o hold à sessão/dispositivo: senão um bot segura a agenda inteira do
    salão por 10 minutos.

PRONTO QUANDO
  - Teste de concorrência: 20 requisições simultâneas no mesmo slot resultam em
    exatamente 1 hold e 19 erros tratados.
  - Hold expirado volta à grade mesmo com o cron desligado.

NÃO FAÇA
  UI (F3.3), pagamento (F4), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.3 — Fluxo de agendamento (UI) · depois de F3.1 e F3.2

```
Você é o agente da tarefa F3.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.4
  2. fases/contexto-comum.md §2
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-3-portal-booking.md    (seu escopo: itens 2 a 4; sua linha: F3.3)

AMBIENTE
  git worktree add ../wt-f3-3 -b f3.3-fluxo        (F3.1 e F3.2 mescladas)

VOCÊ É DONO DE
  app/[slug]/agendar/**

ENTREGUE
  - Fluxo: serviço -> profissional (ou "qualquer um") -> dia e horário -> hold ->
    identificação por OTP -> confirmação.
  - O OTP fica NO FIM, não no começo: pedir login antes de mostrar horário derruba
    conversão. Quando o OTP é pedido, o hold já existe.
  - Contador visível do tempo restante do hold.
  - Expiração durante o fluxo é tratada sem perder o que o cliente já preencheu.
  - Slot tomado por outra pessoa recarrega a grade com mensagem clara.

PRONTO QUANDO
  - E2E completo do portal até a confirmação.
  - E2E do hold expirando no meio do fluxo, com recuperação limpa.
  - Funciona a 360px, sem cor literal.

NÃO FAÇA
  checkout de pagamento (é F4.2), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.4 — Área do cliente

```
Você é o agente da tarefa F3.4 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.4 (área do cliente)
  2. fases/contexto-comum.md §3 e §4
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-3-portal-booking.md    (seu escopo: item 5; sua linha: F3.4)

AMBIENTE
  git worktree add ../wt-f3-4 -b f3.4-minha-conta   (F3.2 já mesclada)

VOCÊ É DONO DE
  app/[slug]/minha-conta/**

ENTREGUE
  - Próximos agendamentos e histórico.
  - Cancelamento dentro da janela configurada pelo tenant. FORA da janela, o botão
    EXPLICA a política em vez de sumir — sumir parece defeito.
  - Remarcação: hold novo + liberação do antigo, de forma atômica.

PRONTO QUANDO
  - Teste: remarcação não deixa o horário antigo preso nem o novo duplicado.
  - Teste: cancelamento dentro e fora da janela se comporta conforme a política.
  - Teste de isolamento: cliente não vê agendamento de outro cliente nem de outro
    tenant.

NÃO FAÇA
  estorno (é F4.3), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F3.5 — Walk-in pelo painel

```
Você é o agente da tarefa F3.5 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.3
  2. fases/contexto-comum.md §4
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-3-portal-booking.md    (seu escopo: item 6; sua linha: F3.5)

AMBIENTE
  git worktree add ../wt-f3-5 -b f3.5-walkin        (F3.2 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/agenda/**

ENTREGUE
  - Staff e Owner criam agendamento pelo painel com source = WALK_IN.
  - Walk-in PODE furar a antecedência mínima (é alguém de pé no balcão), mas NUNCA
    o anti-overlap.
  - Staff cria apenas na própria agenda; Owner, em qualquer uma do tenant.

PRONTO QUANDO
  - Teste provando que walk-in não cria sobreposição.
  - Teste de permissão: Staff não agenda na agenda de outro profissional.

NÃO FAÇA
  cobrança, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

---

# Onda 4 — Fases 4, 6 e 7, em paralelo

## F4.0 ⟨T0⟩ — Máquina de estados e webhooks · roda sozinha na F4

```
Você é o agente da tarefa F4.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §3.2
  2. plano-refatoracao.md §5.5 (webhooks idempotentes)
  3. fases/contexto-comum.md §5 e §6     (você trabalha contra o MockPaymentProvider)
  4. fases/fase-4-pagamentos.md          (seu escopo: item 4; sua linha: F4.0)

AMBIENTE
  git worktree add ../wt-f4-0 -b f4.0-estados       (F3 inteira mesclada)

VOCÊ É DONO DE
  lib/payments/state.ts, app/api/webhooks/payments/**

HERANÇA DA F0.3
  A rota app/api/webhooks/payments/route.ts JÁ EXISTE em versão mínima: verifica
  assinatura e despacha para um handler, sem tocar no banco (na F0.3 o schema
  ainda não estava mesclado, e a dedupe vivia no store do mock). Você assume a
  propriedade dela e a evolui para o que a sua tarefa exige: persistência em
  WebhookEvent, idempotência real por unique(provider, eventId), processamento
  transacional e a máquina de estados. Não recrie do zero sem ler o que está lá.

VOCÊ É O TRONCO DA F4
  F4.1, F4.2 e F4.3 dependem dos seus estados e do seu webhook.

ENTREGUE
  - Máquina de estados Booking x Payment num único lugar, com transições
    permitidas E proibidas explícitas.
  - Webhook: verificação de assinatura ANTES de qualquer coisa; gravação em
    WebhookEvent com unique(provider, eventId); evento repetido responde 200 sem
    reprocessar; processamento transacional.
  - Nunca confie no valor do payload: confronte sempre com o Payment local.
  - Tolerância a eventos FORA DE ORDEM (confirmação chegando depois do estorno):
    decida por estado final, não por ordem de chegada.

PRONTO QUANDO
  - Testes de: pago, recusado, Pix expirado, estorno total, estorno parcial,
    webhook duplicado e webhook fora de ordem.
  - Teste provando que reentrega não credita duas vezes.

NÃO FAÇA
  chamada real ao Asaas (é F8.2), telas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F4.1 — Conta de recebimento e KYC

```
Você é o agente da tarefa F4.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §3.2 (onboarding sem fricção)
  2. plano-refatoracao.md §8.2 (risco de onboarding)
  3. fases/contexto-comum.md §5
  4. fases/fase-4-pagamentos.md          (seu escopo: item 1; sua linha: F4.1)

AMBIENTE
  git worktree add ../wt-f4-1 -b f4.1-subconta      (F4.0 já mesclada)

VOCÊ É DONO DE
  lib/payments/merchant.ts, app/(dashboard)/financeiro/conta/**

ENTREGUE
  - createMerchantAccount a partir do CPF/CNPJ e da chave Pix coletados na F2.5.
  - Persistência em AsaasAccount: accountId, walletId, apiKey CRIPTOGRAFADA em
    repouso (envelope com chave da aplicação), pixKey, kycStatus.
    Chave em texto puro é inaceitável: se o banco vazar, vaza o dinheiro dos
    clientes.
  - Estados de KYC (PENDING, APPROVED, REJECTED) visíveis no painel com o que
    falta fazer.
  - CAMINHO DEGRADADO OBRIGATÓRIO: enquanto não aprovado, o salão opera em
    ON_SITE (pagamento no balcão). Um cadastro travado não pode virar um salão
    que não consegue usar o sistema.

PRONTO QUANDO
  - Dump do banco não revela a chave da subconta, com teste.
  - KYC reprovado no mock não trava o salão: ele segue agendando em ON_SITE.
  - Os estados do painel refletem o que o mock devolve.

NÃO FAÇA
  chamada real ao Asaas, checkout (é F4.2), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F4.2 — Checkout e split

```
Você é o agente da tarefa F4.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §3.2 (as três modalidades e a blindagem fiscal)
  2. plano-refatoracao.md §1.1 (restrições reais do provider)
  3. fases/contexto-comum.md §5
  4. fases/fase-4-pagamentos.md          (seu escopo: itens 2 e 3; sua linha: F4.2)

AMBIENTE
  git worktree add ../wt-f4-2 -b f4.2-checkout      (F4.0 já mesclada)

VOCÊ É DONO DE
  app/[slug]/checkout/**, lib/payments/charge.ts

REGRA QUE SUSTENTA O NEGÓCIO
  A cobrança do serviço nasce NA SUBCONTA do estabelecimento, com split levando
  apenas a taxa para a carteira da plataforma. Se a cobrança sair na conta
  principal e o dinheiro for repassado por transferência, o faturamento dos salões
  vira receita da empresa de software perante a Receita Federal. Isto não é
  detalhe de implementação.

ENTREGUE
  - As três modalidades: integral antecipado (Pix/cartão), sinal (fixo ou
    percentual) e pagamento no local.
  - Checkout dentro da janela de 10 minutos do hold, com tempo restante visível.
  - Pix expirado ou cartão recusado devolve o slot.
  - Percentual da taxa da plataforma vindo de CONFIGURAÇÃO, nunca número mágico.

PRONTO QUANDO
  - Teste que FALHA se a cobrança for criada fora da subconta.
  - Teste de Pix expirado liberando o slot.
  - As três modalidades passam de ponta a ponta com o mock, incluindo o webhook
    disparado por /dev/payments.

NÃO FAÇA
  chamada real ao Asaas, mexer na máquina de estados (é F4.0), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F4.3 — Saldo, extrato e estorno

```
Você é o agente da tarefa F4.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §3.2 (o dono não acessa painel externo)
  2. fases/contexto-comum.md §3 e §6
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-4-pagamentos.md          (seu escopo: item 5; sua linha: F4.3)

AMBIENTE
  git worktree add ../wt-f4-3 -b f4.3-extrato       (F4.0 e F4.1 mescladas)

VOCÊ É DONO DE
  app/(dashboard)/financeiro/**

ENTREGUE
  - Saldo disponível e a liberar, e extrato — DENTRO do painel. O dono do salão
    nunca precisa abrir painel de terceiro.
  - Estorno conforme a política de cancelamento do tenant, total e parcial.

PRONTO QUANDO
  - Estorno gera lançamento e o webhook correspondente é tratado.
  - Valores em centavos ponta a ponta, sem conversão para float em nenhum passo.
  - Teste de isolamento: extrato do tenant A nunca aparece para o tenant B.

NÃO FAÇA
  chamada real ao Asaas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F6.0 ⟨T0⟩ — Templates, jobs e runner · roda sozinha na F6

```
Você é o agente da tarefa F6.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §4
  2. plano-refatoracao.md §5.6
  3. fases/contexto-comum.md §5 (MockWhatsAppProvider)
  4. fases/fase-6-notificacoes.md        (seu escopo: itens 1 e 2; sua linha: F6.0)

AMBIENTE
  git worktree add ../wt-f6-0 -b f6.0-jobs          (F3 inteira mesclada)

VOCÊ É DONO DE
  lib/messaging/jobs.ts, lib/messaging/templates.ts,
  app/api/cron/send-notifications/**

ENTREGUE
  - Registro CENTRAL de templates: nome, categoria e variáveis. O mock recusa
    envio de template não registrado — é o que garante que a aprovação da Meta na
    F8 não vire retrabalho.
  - NotificationJob persistido: lembrete é LINHA NO BANCO, não setTimeout.
    setTimeout não sobrevive a deploy em ambiente serverless.
  - Runner com lock/claim (UPDATE ... RETURNING) para que cron sobreposto não
    envie duas vezes.
  - Cron a cada 5 minutos com janela de tolerância, retry com backoff, limite de
    tentativas e estado final de falha.

PRONTO QUANDO
  - Teste: cron rodando duas vezes não envia duas vezes.
  - Teste: template não registrado é recusado.

NÃO FAÇA
  Cloud API real (é F8.3), gatilhos de negócio (F6.1), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F6.1 — Gatilhos e cancelamento

```
Você é o agente da tarefa F6.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §4 (D-1, H-2 e conteúdo das mensagens)
  2. fases/contexto-comum.md §3 (fuso)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-6-notificacoes.md        (seu escopo: item 3; sua linha: F6.1)

AMBIENTE
  git worktree add ../wt-f6-1 -b f6.1-gatilhos      (F6.0 já mesclada)

VOCÊ É DONO DE
  lib/messaging/triggers.ts

ENTREGUE
  - Confirmação imediata: data, hora, profissional, endereço e link do Google Maps.
  - D-1 (24h antes) com botão de confirmação de presença, e o retorno do clique
    atualizando o agendamento.
  - H-2 (2h antes), curto.
  - Cancelamento e remarcação para cliente E profissional; novo agendamento para
    o profissional.
  - Agendamento cancelado CANCELA os lembretes pendentes. Nada pior que lembrete
    de horário que não existe mais.
  - Agendamento criado com menos de 24h não gera D-1; com menos de 2h não gera H-2.
  - Silêncio noturno configurável (não mandar H-2 às 4h da manhã).
  - "24h antes" é sobre o horário LOCAL do tenant.

PRONTO QUANDO
  - Avançar o relógio produz D-1 e H-2 na ordem certa, no fuso do tenant.
  - Cancelar agendamento cancela os jobs pendentes, com teste.
  - Nenhuma mensagem de um tenant sai com dado de outro.

NÃO FAÇA
  texto livre fora de template, Cloud API real, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F6.2 — Opt-out, consentimento e log de entrega

```
Você é o agente da tarefa F6.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §9.3 e plano-refatoracao.md §8.4 (LGPD)
  2. fases/contexto-comum.md
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-6-notificacoes.md        (seu escopo: item 4; sua linha: F6.2)

AMBIENTE
  git worktree add ../wt-f6-2 -b f6.2-preferencias  (F6.0 já mesclada)

VOCÊ É DONO DE
  app/(dashboard)/mensagens/**, lib/messaging/preferences.ts

ENTREGUE
  - Opt-out por cliente, respeitado em tudo que não for transacional crítico.
  - Registro de consentimento (LGPD): quando, por qual canal.
  - Log de entrega com providerMessageId e status, visível no painel. No piloto,
    "o cliente diz que não recebeu" vai acontecer — e alguém precisa conseguir
    verificar.

PRONTO QUANDO
  - Teste: opt-out bloqueia o que deve bloquear e preserva o transacional.
  - O log mostra falhas com o motivo.

NÃO FAÇA
  Cloud API real, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F6.3 — Web Push (opcional)

```
Você é o agente da tarefa F6.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.3
  2. fases/contexto-comum.md
  3. fases/fase-6-notificacoes.md        (seu escopo: item 5; sua linha: F6.3)

AMBIENTE
  git worktree add ../wt-f6-3 -b f6.3-push          (F6.0 já mesclada)

VOCÊ É DONO DE
  lib/push/**

ENTREGUE
  - Web Push ao profissional para novo agendamento e cancelamento.

REGRA DE ESCOPO
  Esta tarefa é OPCIONAL. Se o custo estourar, entregue nada e registre como
  pendência — meia implementação de push é pior que nenhuma, porque cria a
  expectativa de um alerta que não chega.

PRONTO QUANDO
  - Push entregue e testado, OU pendência registrada com justificativa.

NÃO FAÇA
  atrasar a fase por causa desta tarefa, push de git, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F7.0 ⟨T0⟩ — Planos e limites · roda sozinha na F7

```
Você é o agente da tarefa F7.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §6.1 (tabela de planos)
  2. fases/contexto-comum.md §5
  3. fases/paralelizacao.md §2 e §4
  4. fases/fase-7-billing-superadmin.md  (seu escopo: item 1; sua linha: F7.0)

AMBIENTE
  git worktree add ../wt-f7-0 -b f7.0-planos        (F2 inteira mesclada)

VOCÊ É DONO DE
  lib/billing/plans.ts, lib/billing/limits.ts

ENTREGUE
  - Solo (R$ 39,90, 1 agenda), Equipe (R$ 79,90, até 4 agendas, branding) e
    Pro (R$ 139,90, agendas ilimitadas, domínio próprio) — em CONFIGURAÇÃO, não
    espalhados pelo código.
  - Enforcement no SERVIDOR. Esconder o botão no front não é limite: chamada
    direta à API fura.
  - Ultrapassar o limite oferece upgrade com o impacto claro.
  - Downgrade com uso acima do limite exige decidir quem desativar ANTES de
    aplicar.

PRONTO QUANDO
  - Teste: chamada direta à API respeita o limite do plano.
  - Teste: downgrade acima do limite não aplica sem decisão explícita.

NÃO FAÇA
  Stripe real (é F8.1), trial (F7.1), telas da plataforma (F7.3),
  push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F7.1 — Trial por 10 agendamentos

```
Você é o agente da tarefa F7.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §6.2 (trial baseado em valor)
  2. fases/contexto-comum.md
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-7-billing-superadmin.md  (seu escopo: item 2; sua linha: F7.1)

AMBIENTE
  git worktree add ../wt-f7-1 -b f7.1-trial         (F7.0 já mesclada)

VOCÊ É DONO DE
  lib/billing/trial.ts

ENTREGUE
  - Contador por tenant incrementado na CONFIRMAÇÃO do agendamento, nunca na
    criação do hold — senão hold abandonado consome trial.
  - No 8º agendamento: aviso amigável no painel convidando a escolher o plano.
  - No 11º: bloqueia NOVOS agendamentos, preservando acesso a tudo que já existe.
    A spec pede suspensão graciosa; derrubar a agenda de um salão em
    funcionamento é o oposto disso.
  - DOCUMENTE a decisão: agendamento cancelado desconta do trial? (recomendado:
    não descontar os cancelados pelo salão; descontar os concluídos).

PRONTO QUANDO
  - Teste: hold abandonado não consome trial.
  - Teste: bloqueio no 11º não apaga nem esconde o que já existe.

NÃO FAÇA
  Stripe real, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F7.2 — Ciclo de cobrança B2B

```
Você é o agente da tarefa F7.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §3.1 (Stripe Billing direto, sem Connect)
  2. fases/contexto-comum.md §5 e §6
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-7-billing-superadmin.md  (seu escopo: item 3; sua linha: F7.2)

AMBIENTE
  git worktree add ../wt-f7-2 -b f7.2-cobranca      (F7.0 já mesclada)

VOCÊ É DONO DE
  lib/billing/subscription.ts, app/api/webhooks/billing/**

CONTEXTO
  Stripe cobra APENAS a mensalidade do software, na conta única da plataforma. O
  dono do salão não tem conta no Stripe. Todo o dinheiro B2C (serviços e clube)
  é do Asaas, em outra fase.

ENTREGUE
  - Assinar, trocar de plano com proração, atualizar meio de pagamento, cancelar.
  - Inadimplência: retentativa -> aviso -> suspensão graciosa -> reativação.
  - Webhooks idempotentes (contexto-comum.md §6).
  - Tudo contra o mock de billing; a implementação real é F8.1.

PRONTO QUANDO
  - Ciclo completo com o mock: assinar, trocar, inadimplir, suspender, reativar.
  - Suspensão preserva dados e o acesso ao que já existe.

NÃO FAÇA
  criar conta ou chave Stripe, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F7.3 — Painel do Super Admin

```
Você é o agente da tarefa F7.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. spec-executiva.md §2.1
  2. fases/contexto-comum.md §4 (caminho auditado do Super Admin)
  3. fases/paralelizacao.md §4 e §5
  4. fases/fase-7-billing-superadmin.md  (seu escopo: item 4; sua linha: F7.3)

AMBIENTE
  git worktree add ../wt-f7-3 -b f7.3-plataforma    (F7.0 já mesclada; F1.4 também)

VOCÊ É DONO DE
  app/(platform)/**

ENTREGUE
  - Lista de tenants com status, plano, uso e saúde da conta de recebimento.
  - MRR, churn, tenants em trial e taxa de conversão.
  - Acesso ao contexto de um tenant para suporte — SEMPRE via asPlatformAdmin()
    e SEMPRE registrado em AuditLog. Ninguém olha dado de cliente de salão sem
    deixar rastro.

PRONTO QUANDO
  - Owner comum não acessa nenhuma rota de (platform), com teste.
  - Todo acesso de suporte a dado de tenant aparece no AuditLog, com teste.

NÃO FAÇA
  bypass de RLS, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

---

# Onda 5 — Fase 5: Clube de assinatura

## F5.0 ⟨T0⟩ — Planos e benefícios do tenant · roda sozinha na F5

```
Você é o agente da tarefa F5.0 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-5-clube-assinatura.md    (leia o aviso do topo; sua linha: F5.0)
  2. plano-refatoracao.md §1 (decisão D3) e §1.1
  3. fases/contexto-comum.md §3 e §5
  4. fases/paralelizacao.md §4 e §5

AVISO IMPORTANTE
  Este módulo NÃO está na spec-executiva.md. É requisito confirmado do dono do
  produto, fora do documento. Não o remova por não encontrá-lo na spec.

AMBIENTE
  git worktree add ../wt-f5-0 -b f5.0-planos-clube   (F4 inteira mesclada)

VOCÊ É DONO DE
  app/(dashboard)/clube/**, lib/membership/plans.ts

CONTEXTO DA MODELAGEM
  No MVP antigo a assinatura era da PLATAFORMA, global, via Stripe. Agora ela
  pertence ao TENANT: preço, benefícios e recebimento são do salão. Não reaproveite
  as tabelas Subscription/SubscriptionBenefit antigas.

ENTREGUE
  - CRUD de MembershipPlan (nome, preço em centavos, ciclo, ativo) e de
    MembershipBenefit (serviço x quantidade por ciclo).
  - Mudança de preço NÃO altera assinatura vigente sem decisão explícita: quem já
    assinou continua no preço contratado até o dono decidir o contrário.

PRONTO QUANDO
  - Teste: alterar o preço do plano não altera a assinatura ativa.
  - Benefícios só apontam para serviços do próprio tenant, com teste de isolamento.

NÃO FAÇA
  cobrança (é F5.1), créditos (F5.2), integração real, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F5.1 — Assinatura recorrente

```
Você é o agente da tarefa F5.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-5-clube-assinatura.md    (seu escopo: itens 2 e 5; sua linha: F5.1)
  2. plano-refatoracao.md §1.1           (restrições REAIS do provider — leia inteiro)
  3. fases/contexto-comum.md §5 e §6
  4. fases/paralelizacao.md §4 e §5

AMBIENTE
  git worktree add ../wt-f5-1 -b f5.1-assinatura     (F5.0 já mesclada)

VOCÊ É DONO DE
  lib/membership/subscription.ts

RESTRIÇÕES REAIS QUE O MOCK JÁ COBRA (não as contorne)
  - remoteIp é o IP do DISPOSITIVO DO PAGADOR, nunca o do servidor. Atrás de
    proxy/CDN, extraia do header correto e trate a ausência. Passar o IP do
    servidor funciona no mock permissivo e é recusado pelo provider real — por
    isso o nosso mock recusa de propósito.
  - O token de cartão pertence ao cliente que o originou e NÃO pode ser
    reaproveitado para outro cliente.
  - Split em assinatura é suportado, mas NUNCA para a carteira de quem cria a
    cobrança. A cobrança nasce na subconta do salão, com split para a plataforma.

ENTREGUE
  - tokenizeCard e createSubscription na subconta, com split.
  - Ciclo de vida: renovação, falha de cobrança (retentativa e suspensão graciosa),
    cancelamento pelo cliente e pelo dono, e o destino dos créditos do ciclo
    corrente ao cancelar.
  - Tudo por webhook idempotente.

PRONTO QUANDO
  - Ciclo completo com o mock: assinar, renovar, falhar, suspender, cancelar.
  - Teste que FALHA se remoteIp for do servidor.
  - Teste que FALHA se a cobrança sair da conta da plataforma em vez da subconta.

NÃO FAÇA
  chamada real ao Asaas (é F8.2), créditos (F5.2), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F5.2 — Ledger de créditos e consumo · COORDENE ANTES DE COMEÇAR

```
Você é o agente da tarefa F5.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-5-clube-assinatura.md    (seu escopo: itens 3 e 4; sua linha: F5.2)
  2. fases/contexto-comum.md §3 e §7
  3. fases/paralelizacao.md §4 (mapa de propriedade)
  4. lib/booking/  — o código que você vai tocar

ATENÇÃO, ÚNICO PONTO DE DISPUTA DO PROJETO
  Esta é a única tarefa que toca arquivo de outra fase: o consumo de crédito entra
  na transação de agendamento da F3. Combine com o dono de lib/booking/ ANTES de
  começar. Não descubra isso no merge.

AMBIENTE
  git worktree add ../wt-f5-2 -b f5.2-creditos       (F5.0 já mesclada)

VOCÊ É DONO DE
  lib/membership/credits.ts + o ponto de integração acordado em lib/booking/

ENTREGUE
  - CreditLedger APPEND-ONLY (delta, reason, bookingId). Saldo é a SOMA dos
    lançamentos, nunca um contador mutável — "UPDATE ... SET remaining =
    remaining - 1" fora da transação do agendamento gera crédito fantasma, e no
    piloto alguém vai perguntar "por que meu crédito sumiu".
  - Consumo na MESMA transação do agendamento: nunca dois créditos para um
    agendamento, nunca crédito debitado sem agendamento.
  - Cancelamento dentro da política DEVOLVE o crédito como lançamento NOVO, sem
    editar o antigo.
  - Renovação do ciclo credita. DECIDA E DOCUMENTE: crédito não usado expira ou
    acumula? (recomendado: expira, com aviso).
  - No fluxo de agendamento, havendo crédito, o checkout da F4 é pulado.

PENDÊNCIA DE PRODUTO (não invente a resposta)
  Cliente do clube ainda paga sinal como garantia contra no-show? Enquanto não
  houver resposta, implemente SEM sinal e deixe a decisão isolada atrás de uma
  flag de política do tenant.

PRONTO QUANDO
  - Teste de concorrência: dois agendamentos simultâneos com UM crédito — um
    passa, um falha.
  - Cancelar devolve o crédito e o ledger conta a história inteira.

NÃO FAÇA
  alterar schema, mexer em lib/booking/ além do ponto acordado, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F5.3 — Visões do clube

```
Você é o agente da tarefa F5.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-5-clube-assinatura.md    (seu escopo: item 6; sua linha: F5.3)
  2. fases/contexto-comum.md §2 e §4
  3. fases/paralelizacao.md §4 e §5

AMBIENTE
  git worktree add ../wt-f5-3 -b f5.3-visoes-clube   (F5.1 e F5.2 mescladas)

VOCÊ É DONO DE
  app/[slug]/clube/**, app/(dashboard)/clube/relatorios/**

ENTREGUE
  - Cliente: plano atual, saldo de créditos, próxima cobrança, cancelar.
  - Owner: assinantes, MRR do clube, inadimplentes, consumo por serviço.

PRONTO QUANDO
  - Assinante do tenant A é invisível no painel do tenant B, com teste.
  - Saldo exibido vem da soma do ledger, nunca de contador paralelo.

NÃO FAÇA
  alterar regra de crédito (é F5.2), push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

---

# Onda 6 — Fase 8: Integrações reais

Cada tarefa só começa quando a credencial correspondente existir (ver `fase-8-integracoes-reais.md` §1). As três são independentes entre si.

## F8.1 — Adaptador Stripe

```
Você é o agente da tarefa F8.1 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-8-integracoes-reais.md   (seu escopo: §2; sua linha: F8.1)
  2. fases/contexto-comum.md §5 e §6
  3. lib/billing/  e  lib/payments/types.ts  — os contratos que você implementa

PRÉ-REQUISITO
  Conta Stripe criada, cobrança em BRL ativa e chaves de TESTE disponíveis no
  ambiente. Se não estiverem, PARE e avise — não crie conta nem peça cartão.

AMBIENTE
  git worktree add ../wt-f8-1 -b f8.1-stripe         (F7 mesclada)

VOCÊ É DONO DE
  lib/payments/stripe.ts, scripts/stripe-setup.ts

REGRA CENTRAL DESTA FASE
  Você troca a implementação, não o produto. Se precisar mexer em tela ou em regra
  de negócio, houve vazamento de abstração numa fase anterior: PARE e reporte, em
  vez de contornar aqui.

ENTREGUE
  - Adaptador do BillingProvider contra a API real (test mode).
  - Produtos e preços dos três planos criados por SCRIPT VERSIONADO, não à mão
    no painel.
  - Webhook com verificação de assinatura e a mesma idempotência do mock.

PRONTO QUANDO
  - A suíte de contrato roda verde contra mock E test mode, sem ramificação por
    provider no código de produto.
  - git diff mostra que NENHUM arquivo fora de lib/payments/ e scripts/ mudou.
  - Rollback para mock por variável de ambiente, testado.

NÃO FAÇA
  commitar segredo, criar conta, mexer em telas, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F8.2 — Adaptador Asaas

```
Você é o agente da tarefa F8.2 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-8-integracoes-reais.md   (seu escopo: §3; sua linha: F8.2)
  2. plano-refatoracao.md §1.1 e §8.3    (restrições e conformidade fiscal)
  3. fases/contexto-comum.md §5 e §6
  4. lib/payments/types.ts e lib/payments/mock.ts — o contrato e o comportamento
     de referência

PRÉ-REQUISITO
  Conta Asaas da plataforma aprovada, com API de subcontas e split liberada, e
  credenciais de SANDBOX no ambiente. Se não estiverem, PARE e avise.

AMBIENTE
  git worktree add ../wt-f8-2 -b f8.2-asaas          (F5 mesclada)

VOCÊ É DONO DE
  lib/payments/asaas.ts

ONDE A REALIDADE MORDE MAIS QUE O MOCK
  - Subcontas: KYC assíncrono, com recusa e pendência. Mapeie os status reais para
    os nossos e TESTE o caminho degradado (ON_SITE) com uma conta reprovada de
    verdade.
  - Split: confirme em sandbox que a cobrança nasce na subconta e só a taxa vai
    para a plataforma. Se sair invertido, o desenho fiscal do projeto cai por terra.
  - remoteIp: em produção, atrás de proxy/CDN, vem em header específico. Errar
    aqui só aparece em produção, com cartão recusado.
  - Webhooks: token de autenticação, reentrega e ordem imprevisível.
  - Chaves de subconta: criptografadas em repouso, com rotação prevista.

PRONTO QUANDO
  - Contrato verde contra mock E sandbox.
  - git diff mostra que NENHUM arquivo fora de lib/payments/ mudou.
  - Antes de produção: cobrança real de R$ 1,00 ponta a ponta com split, Pix e
    cartão, conferida no extrato.

NÃO FAÇA
  commitar chave, alterar regra de negócio, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F8.3 — Adaptador WhatsApp Cloud API

```
Você é o agente da tarefa F8.3 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-8-integracoes-reais.md   (seu escopo: §4; sua linha: F8.3)
  2. fases/contexto-comum.md §5
  3. lib/messaging/templates.ts — o registro central criado na F6.0

PRÉ-REQUISITO
  Meta Business verificado, número dedicado e TEMPLATES APROVADOS. Sem isso, não
  há o que integrar: PARE e avise.

AMBIENTE
  git worktree add ../wt-f8-3 -b f8.3-whatsapp       (F6 mesclada)

VOCÊ É DONO DE
  lib/messaging/cloud-api.ts

ENTREGUE
  - Adaptador do WhatsAppProvider com os templates aprovados.
  - Os nomes dos templates aprovados têm de BATER com o registro central da F6.
    Se a Meta exigir texto diferente, ATUALIZE O REGISTRO — não improvise texto
    livre no código.
  - Janela de 24h: fora dela, só template.
  - O botão de confirmação do D-1 chega como webhook de resposta e precisa ser
    tratado.
  - Monitoramento da classificação de qualidade do número (ela cai com bloqueio
    de usuário).
  - Fallback definido para falha de entrega.

PRONTO QUANDO
  - OTP real entregue em número real em menos de 30 segundos.
  - D-1 real entregue no horário certo, com o botão atualizando o agendamento.
  - git diff mostra que NENHUM arquivo fora de lib/messaging/ mudou.

NÃO FAÇA
  texto livre fora de template, commitar token, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```

## F8.4 — Observabilidade e corte

```
Você é o agente da tarefa F8.4 do projeto kg-barbershop (SaaS multi-tenant de agendamento).

LEIA NESTA ORDEM:
  1. fases/fase-8-integracoes-reais.md   (seu escopo: §5; sua linha: F8.4)
  2. fases/contexto-comum.md §5

AMBIENTE
  git worktree add ../wt-f8-4 -b f8.4-observabilidade

VOCÊ É DONO DE
  lib/observability/**, configuração de ambiente

ENTREGUE
  - Logs estruturados nas integrações.
  - Alerta de falha de webhook e de cobrança.
  - Painel mínimo de saúde das integrações.
  - Flags PAYMENT_PROVIDER, MESSAGING_PROVIDER e BILLING_PROVIDER com rollback
    para mock em segundos.
  - Os MOCKS CONTINUAM EXISTINDO: são o que faz o CI rodar sem rede e sem gastar
    dinheiro. Não os remova.

PRONTO QUANDO
  - Rollback para mock testado de verdade, não só documentado.
  - CI continua verde sem acesso à rede.

NÃO FAÇA
  remover mocks, commitar segredo, push, PR sem pedido.

VERIFIQUE ANTES DE DIZER QUE TERMINOU (rode os comandos, não presuma)
  npm run typecheck && npm run lint && npm run test
  Cole a saída real no seu relatório. Tarefa sem essa saída não está entregue.

SE ALGO NÃO ESTIVER CLARO
  Não invente nome de campo, de arquivo, de rota nem de API. Procure no
  repositório (rg/grep) e leia o código antes de escrever. Se ainda assim não
  estiver claro, PARE e pergunte: uma pergunta custa minutos, um chute custa a
  tarefa inteira e o tempo de quem revisa.

RELATÓRIO FINAL (obrigatório, nesta estrutura)
  1. Arquivos criados e alterados
  2. Saída de typecheck, lint e test
  3. O que ficou fora do escopo e por quê
  4. Dúvidas ou decisões que precisam de confirmação humana
```
