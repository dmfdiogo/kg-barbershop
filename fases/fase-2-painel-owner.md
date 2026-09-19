# Fase 2 — Painel do Owner

> **Depende de:** F1 · **Estimativa:** 18 dias · **Paralelismo:** pode rodar junto com F3 (usa o seed da F0 para não depender das telas desta fase).
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), spec §2.2 e §5.1.

## Objetivo

O dono configura o estabelecimento inteiro sozinho, em menos de 10 minutos (diretriz §9.2 da spec), e o portal já sai com a cara da marca dele.

## Escopo

> **Todo o painel vive sob `/painel`** (`app/(dashboard)/painel/<feature>/`), e não na raiz. Dois motivos que não valem trocar por uma lista de reservados maior:
>
> 1. **Cada palavra reservada é um slug que nenhum cliente pode ter.** A spec vende `agendex.com.br/[slug]` como o endereço do estabelecimento; reservar `agenda`, `financeiro`, `clube`, `marca`, `equipe` — substantivos comuns em português — tira do cliente o namespace que é o produto. Um petshop chamado "Agenda Pet" não poderia usar `agenda`.
> 2. **A lista cresceria a cada feature, num arquivo de dono único.** `lib/tenant/slugs.ts` é da F1.0, e as folhas F2.1–F2.5 rodam em paralelo: cinco agentes editando o mesmo arquivo é exatamente o conflito que o mapa de propriedade existe para evitar.
>
> De quebra, isso resolve a armadilha que a F1.4 descobriu: `notFound()` lançado no layout de um **grupo** escapa para o 404 da raiz. `app/(dashboard)/layout.tsx` é layout de grupo; `app/(dashboard)/painel/layout.tsx` é de segmento, e é lá que o portão funciona.

### 1. Onboarding guiado

Passo a passo curto: dados do estabelecimento → horário de expediente → primeiro serviço → link do portal pronto para colar no WhatsApp. Estado salvo a cada passo (ele vai abandonar no meio e voltar).

O passo financeiro (CPF/CNPJ + chave Pix) é **coletado e persistido** aqui, mas a criação de subconta é F4 via mock. Colete e mostre o estado "aguardando ativação".

### 2. Serviços

CRUD com duração, buffer, preço (centavos), modalidade de cobrança (`FULL_PREPAID` / `DEPOSIT` / `ON_SITE`), valor ou percentual do sinal, profissionais habilitados, ativo/inativo. Serviço com agendamento futuro **não é excluído** — é desativado.

### 3. Equipe e jornadas

Convite de membro por telefone (vira `TenantMember` com papel `STAFF`; o login é o OTP da F1). Jornada semanal por profissional, bloqueios pontuais (almoço, folga, emergência) e vínculo profissional × serviços.

Validação obrigatória: reduzir jornada ou criar bloqueio sobre agendamento existente **não pode** apagar o agendamento silenciosamente. Liste os conflitos e obrigue uma decisão.

### 4. Políticas e endereço do portal

Janela de cancelamento (padrão 24h), política de no-show, antecedência mínima e máxima para agendar.

**Endereço do portal** (spec §2.2): edição do *slug* do estabelecimento, recusando a lista de palavras reservadas entregue pela F1.0 — um tenant com slug `painel` ou `api` ficaria inacessível. Slug já em uso por outro tenant também é recusado. O campo de domínio próprio aparece como indisponível fora do plano Pro (o provisionamento é fase 2 do produto).

### 5. White-label

Upload de logo (PNG/JPG/SVG, com limite de tamanho e validação de tipo real, não só extensão), cores primária/secundária/fundo, e os 4 presets da spec §5.1 (*Classic Barber*, *Beauty & Spa*, *Pet Friendly*, *Auto Detail*). Preview ao vivo.

**Preset grava cores, não vínculo.** Ao aplicar um preset, persista as três cores nas colunas do `Tenant`; `themePreset` fica apenas como rótulo de qual preset foi o ponto de partida. O `lib/theme/resolve.ts` da F3.0 ignora o campo de propósito. O motivo é de produto: se o preset fosse vínculo vivo, mexer na paleta "Classic Barber" mudaria a identidade visual de todos os salões que a usam, sem que eles pedissem — e o dono não conseguiria ajustar uma cor isolada sem sair do preset.

As cores viram CSS variables injetadas no SSR do portal — é o que evita o flash de tema errado. **A injeção em si é da F3.0** (`lib/theme/resolve.ts`, entregue com valores padrão); você entrega a tela de edição, os presets (`lib/theme/presets.ts`) e o preview, consumindo aquele resolvedor. Não reimplemente a injeção. **Valide contraste**: um dono pode escolher amarelo sobre branco e tornar o próprio portal ilegível. Avise antes de salvar.

### 6. Dashboard operacional

Faturamento do dia/mês, taxa de ocupação por profissional, agenda do dia. Enquanto F4 não existe, faturamento vem dos `Booking` confirmados.

## Fora do escopo

Criação real de subconta (F4), cobranças (F4), clube (F5), notificações (F6), assinatura da plataforma (F7).

## Critérios de aceite

1. Onboarding do zero ao link do portal em menos de 10 minutos, cronometrado em e2e.
2. Trocar o preset muda o portal público sem flash de tema errado (verificar no HTML do SSR, não só visualmente).
3. Reduzir jornada com agendamento no intervalo apresenta conflitos e exige decisão.
4. Owner do tenant A não lê nem edita nada do tenant B (teste de isolamento).
5. Staff **não** acessa as telas de configuração.
6. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Upload.** Valide o tipo pelo conteúdo; SVG aceita script — sanitize ou sirva com `Content-Security-Policy` adequado.
- **Cor literal.** Qualquer `text-black` cravado num componente de produto quebra o white-label de um cliente.

---

## Tarefas

Fase com o maior paralelismo do projeto: depois do tronco, **quatro folhas simultâneas**.

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F2.0** ⟨T0⟩ | Shell do painel: layout, navegação descoberta por feature (sem arquivo-lista), tokens de tema, estados vazio/erro/carregando | `app/(dashboard)/painel/layout.tsx`, `components/dashboard/**` | F1 | 2,5 |
| **F2.1** | Serviços: CRUD, duração, buffer, preço, modalidade de cobrança, desativação | `app/(dashboard)/painel/servicos/**`, `lib/catalog/**` | F2.0 | 3 |
| **F2.2** | Equipe, convite por telefone, jornadas, bloqueios e detecção de conflito com agendamentos | `app/(dashboard)/painel/equipe/**`, `lib/staffing/**` | F2.0 | 4 |
| **F2.3** | White-label: logo, cores, 4 presets, preview, validação de contraste (a injeção SSR é da F3.0) | `app/(dashboard)/painel/marca/**`, `lib/theme/presets.ts` | F2.0, F3.0 | 3 |
| **F2.4** | Políticas do tenant e dashboard operacional | `app/(dashboard)/painel/configuracoes/**`, `app/(dashboard)/painel/inicio/**` | F2.0 | 3 |
| **F2.5** | Onboarding guiado, reusando as server actions das folhas | `app/(dashboard)/painel/onboarding/**` | F2.1, F2.2, F2.3 | 2,5 |
