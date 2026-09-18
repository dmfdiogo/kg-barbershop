# kg-barbershop

SaaS multi-tenant de agendamento e pagamento para prestadores de serviço locais
(barbearias, salões, petshops, clínicas estéticas, lava-rápidos). Cada
estabelecimento é um **tenant** com portal próprio, identidade visual própria e
recebimento financeiro próprio.

- **O produto:** [`spec-executiva.md`](spec-executiva.md) — fonte de verdade de escopo.
- **A refatoração:** [`plano-refatoracao.md`](plano-refatoracao.md) — estratégia e modelo de dados.
- **O trabalho:** [`fases/`](fases/) — 9 fases, 42 tarefas, uma por agente. Comece por [`fases/README.md`](fases/README.md).

O repositório está sendo reescrito a partir de um MVP antigo single-tenant. Se
algo no código contradiz a spec, a spec vence.

---

## Como rodar

```bash
cp .env.example .env     # sem isto, os testes falham (e um .env antigo também)
npm ci                   # o postinstall roda `prisma generate`
npm run db:up            # Postgres 17 com btree_gist, via docker compose
npm run db:reset         # aplica migrations e roda o seed
npm run dev              # http://localhost:3000
```

**Se o Docker não subir** (é o caso das máquinas usadas até aqui), pule o
`db:up` e aponte `DATABASE_URL` para um Postgres 17 local. A única exigência é a
extensão `btree_gist`, criada pela própria migration. O `docker-compose.yml`
segue como o único artefato da fundação nunca validado de ponta a ponta.

**Se o seu `.env` é antigo**, recopie do exemplo. Fases novas acrescentam
variáveis lá, e como `.env` não é versionado, um arquivo defasado quebra de
formas confusas — a suíte e2e caiu assim depois da fase 1, por falta de
`APP_DOMAIN`.

### O que o seed cria

Dois tenants, de propósito ([`prisma/seed.mts`](prisma/seed.mts)):

| | |
| :--- | :--- |
| `/carlosbarber` | completo: 3 profissionais com jornadas diferentes (um folga na segunda, um com almoço), 5 serviços cobrindo as três modalidades de cobrança, 20 clientes, agendamentos passados e futuros, clube com assinante ativo, subconta aprovada |
| `/petspaluna` | mínimo: existe para que qualquer teste de isolamento tenha um segundo tenant sem precisar montar dado. Subconta com KYC **pendente**, para exercitar o caminho degradado |

O seed é idempotente: apaga os dois tenants pelos ids fixos e recria.

## Comandos

| | |
| :--- | :--- |
| `npm run dev` · `build` · `start` | Next.js |
| `npm run typecheck` | `next typegen && tsc --noEmit` — autossuficiente, não depende de build anterior |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unidade + integração; integração precisa do Postgres) |
| `npm run test:e2e` | Playwright (`npx playwright install chromium` na primeira vez) |
| `npm run db:migrate` · `db:deploy` · `db:reset` · `db:seed` · `db:studio` | Prisma |

---

## Invariantes

Estas regras não são estilo; quebrá-las quebra o produto. A versão completa está
em [`fases/contexto-comum.md`](fases/contexto-comum.md).

**Dinheiro é `Int` em centavos.** Nunca `Float`, nunca `Decimal`. É o formato de
Asaas e Stripe e elimina erro de arredondamento no split.

**Tempo é `timestamptz`, sempre UTC no banco.** Todo cálculo de grade acontece no
fuso do tenant (`Tenant.timezone`). **Proibido** `getUTCDay()`/`setUTCHours()`
para decidir dia de expediente — foi um bug real do código antigo, e em UTC-3 ele
joga um agendamento das 22h para o dia seguinte.

**Toda tabela de negócio tem `tenantId`**, mesmo quando dá para chegar lá por
join.

**Isolamento em duas camadas, ambas obrigatórias.** Todo acesso passa pelo client
escopado ([`lib/tenant/db.ts`](lib/tenant/db.ts)), que abre transação e executa
`set_config('app.current_tenant', …)`; e a RLS está ligada com `FORCE` em todas
as tabelas com `tenantId`. Nunca importe `PrismaClient` cru em código de produto.
Remover uma camada "porque a outra cobre" é regressão de segurança.

**A callback do client escopado pode rodar duas vezes.** Sob disputa de slot o
Postgres devolve `40P01`/`P2034` e o client faz retry. Tudo lá dentro precisa ser
reexecutável e viver no banco — nada de chamada externa ou efeito em memória.

**Nada de cor literal em componente de produto.** Sempre token CSS. Cores de
marca (`--color-primary`, `--color-secondary`, `--color-background`) são
customizáveis pelo tenant; cores de status (`--color-success`, `--color-warning`,
`--color-danger`) são fixas — vermelho de cancelamento precisa significar
cancelamento em todo salão.

**Double-booking é impedido pelo banco**, não por `if`: uma *exclusion
constraint* (`booking_no_overlap`) sobre `tstzrange(starts_at, blocked_until)`
por profissional. A violação chega como `23P01` e é traduzida para
`SlotUnavailableError`.

---

## Providers externos: tudo mock até a fase 8

WhatsApp, Asaas e Stripe ficam atrás de interfaces
([`lib/payments/`](lib/payments), [`lib/messaging/`](lib/messaging)), com
implementação mock escolhida por variável de ambiente. **Nenhuma fase de F0 a F7
precisa de conta, chave ou rede.** Se algo pedir credencial antes da F8, saiu do
escopo.

Os mocks recusam o que o serviço real recusaria (split apontando para a própria
carteira, IP de servidor como `remoteIp`, template de WhatsApp não registrado) e
disparam webhook de verdade contra a própria aplicação, para exercitar o caminho
assíncrono.

Em desenvolvimento, `/dev/outbox` mostra as mensagens enviadas (é onde se lê o
código de OTP) e `/dev/payments` permite confirmar, recusar ou estornar cobranças.
As duas rotas respondem 404 fora de desenvolvimento.

---

## Convenções

- Interface em **pt-BR**; código, nomes e mensagens de commit em **inglês**.
- Banco em `snake_case` (via `@map`/`@@map`); TypeScript em `camelCase`.
- ESLint fixado na linha 9: o `eslint-config-next` 16 quebra no ESLint 10.
- Prisma fixado em 7.10.0: o dist-tag `latest` aponta para uma release candidate.

## Testar no celular

O cookie de sessão é `secure: true` sempre — inclusive em desenvolvimento, de
propósito. Por isso `http://192.168.x.x:3000` não guarda sessão. Para testar num
aparelho real, suba com HTTPS:

```bash
npx next dev --experimental-https
```

Afrouxar o `secure` em dev seria testar um cookie diferente do que vai a produção.

## Armadilhas conhecidas

- **Testes compartilham o banco do `DATABASE_URL`** com o desenvolvimento. Rodar
  a suíte mexe no mesmo Postgres do seed. Para trabalho paralelo, use um banco
  por worktree.
- **`npm audit` acusa vulnerabilidades em `mysql2`**, dependência transitiva do
  CLI do Prisma. O projeto é Postgres e o CLI é `devDependency`. **Não rode
  `npm audit fix --force`** — ele rebaixa o Prisma para a 6.x.
