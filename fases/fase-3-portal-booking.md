# Fase 3 — Portal de agendamento e anti-concorrência

> **Depende de:** F1 para a parte de UI · **Estimativa:** 18 dias · **Paralelismo:** pode rodar junto com F2.
>
> **F3.1 e F3.2 não esperam nada além da F0.** São domínio puro (`lib/booking/`): não tocam autenticação, resolução de tenant nem portal. Podem começar junto com a F1.0, o que encurta o caminho crítico — a dependência que este arquivo declarava antes era suposição de ordem de UI, não dependência real.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md), spec §2.4 e §9.1.

## Objetivo

O portal público do estabelecimento, mobile-first: escolher serviço → profissional (ou "qualquer um") → dia/horário → identificar-se por OTP → reserva confirmada. Sem double-booking, mesmo com dois clientes no mesmo segundo.

## Escopo

> **Heranças da F1.0:** `app/[slug]/layout.tsx` (portão que traduz status do tenant em página própria) e `app/tenant-status.tsx` já existem. Você **estende**, não substitui, e preserva o uso de `getTenantContext(slug)` — é ele que memoiza a resolução por requisição. Há também um `app/not-found.tsx` na raiz: qualquer 404 não casado mostra "estabelecimento não encontrado"; um segmento que queira 404 próprio declara o seu.

### 1. Portal SSR

`/[slug]`, renderizado no servidor com o tema do tenant já aplicado. Catálogo de serviços com duração e preço.

**Atenção à fronteira com a F2.3.** As duas tarefas estão na mesma onda e as duas mexem em tema. A divisão é por arquivo: **você entrega `lib/theme/resolve.ts`** — leitura das cores do tenant e injeção das CSS variables no SSR, com valores padrão quando o tenant ainda não configurou nada. A F2.3 entrega a tela de edição e `lib/theme/presets.ts`, e **consome** o seu `resolve.ts`. Ou seja: o portal funciona com tema padrão antes de a F2.3 existir, e ganha as cores do dono quando ela chegar.

### 2. Grade de horários

Consome `lib/booking/availability.ts` (portado na F0). Considera jornada, bloqueios, buffer, agendamentos, antecedência mínima/máxima e o **fuso do tenant**. "Qualquer profissional" une as grades e, na confirmação, escolhe o profissional — distribuindo carga, não sempre o mesmo.

Holds vencidos nunca aparecem como ocupados (`status='HOLD' AND holdExpiresAt > now()`).

### 3. Soft lock de 10 minutos (spec §9.1)

Ao escolher o horário, cria `Booking` com `status='HOLD'` e `holdExpiresAt = now() + 10min`; a exclusion constraint da F0 protege. Regras:

- antes de inserir, a **mesma transação** apaga holds vencidos daquele profissional — senão um hold abandonado e ainda não coletado bloqueia a constraint;
- o cron de limpeza (`/api/cron/expire-holds`) é rede de segurança, não o mecanismo principal;
- a UI mostra o tempo restante e trata a expiração sem perder o que o cliente já preencheu;
- violação da constraint vira "horário acabou de ser reservado" com a grade recarregada — nunca 500.

Enquanto não há pagamento (F4), o hold vira `CONFIRMED` ao concluir.

### 3.1. Costura para as fases seguintes (obrigatório na F3.2)

Três tarefas futuras precisam reagir à confirmação de um agendamento: consumo de crédito do clube (F5.2), lembretes de WhatsApp (F6.1) e contador de trial (F7.1). Se cada uma editar a transação de confirmação, três agentes disputam o mesmo arquivo — e duas delas estão na mesma onda.

Entregue, portanto, **dois pontos de extensão** em `lib/booking/confirm.ts`:

1. **Participantes da transação** — módulos em `lib/booking/participants/*.ts`, descobertos por convenção, executados **dentro** da transação de confirmação. É por aqui que o débito de crédito (F5.2) e o contador de trial (F7.1) entram: os dois precisam ser atômicos com o agendamento. Um participante que lança aborta a confirmação inteira.

   **Todo participante precisa ser reexecutável.** O client escopado faz retry em `P2034` (write conflict sob disputa de slot), então a transação inteira — participantes incluídos — pode rodar duas vezes. Só efeito no banco, nada fora dele. Escreva isso no contrato que você documentar.
2. **Eventos pós-commit** — `BookingConfirmed`, `BookingCancelled`, `BookingRescheduled`, emitidos **depois** do commit, para efeitos que não podem derrubar o agendamento se falharem. É por aqui que os lembretes (F6.1) entram: WhatsApp fora do ar não pode impedir alguém de marcar horário.

Sem arquivo-lista central: cada feature deixa o seu próprio arquivo na pasta. Documente o contrato dos dois pontos — F5.2, F6.1 e F7.1 vão implementar contra ele sem te consultar.

**Contratos vindos da F3.1, para quem consome a grade (F3.3 e F3.5):**
>
> - `selectStaffForSlot` recebe a carga por parâmetro (`Record<staffId, número>`) e **não** consulta o banco. Use a contagem de agendamentos do **dia** (HOLD vigente + CONFIRMED), não o total histórico: o objetivo é espalhar o trabalho de hoje, não igualar placar de carreira. Minutos ocupados é refinamento para depois, se a equipe reclamar de justiça.
> - Quem filtra quais profissionais atendem o serviço é o chamador (`StaffService`); a grade recebe a lista já filtrada.

**Contrato de entrada vindo da F3.0:** o catálogo já aponta para `/<slug>/agendar?servico=<id>`. Use exatamente esse caminho e esse nome de parâmetro — o link já existe em produção do portal, e mudar aqui quebraria o CTA sem ninguém perceber até alguém clicar.

**Clique duplo na confirmação (decisão para a F3.3).** `confirmBooking` recusa quem já está `CONFIRMED`, lançando `INVALID_STATE`. Na tela isso apareceria como erro para alguém cujo agendamento **deu certo** — conexão ruim, o cliente toca duas vezes, e a segunda resposta diz que falhou. Torne idempotente na F3.3: se o agendamento já está confirmado **e é do mesmo cliente**, devolva sucesso com o agendamento existente em vez de erro. Confirmação alheia continua sendo erro.

**Trabalho periódico atravessa tenants por um ponto só.** O cron de expiração usa `listAllTenantIds()` (lib/tenant) para enumerar e depois escreve por `forTenant`, tenant a tenant, com RLS. A F6.0 tem a mesma necessidade e deve usar a mesma função — não peça exceção de lint para o `asPlatformAdmin`, senão a lista de exceções cresce a cada cron.

### 4. Identificação do cliente

OTP da F1 **no fim do fluxo**, não no começo: pedir login antes de mostrar horário derruba conversão. O hold já existe quando o OTP é pedido.

### 5. Área do cliente

Próximos agendamentos, histórico, cancelar (dentro da janela do tenant) e remarcar (remarcação = hold novo + liberação do antigo, atômico). Fora da janela, o botão explica a política em vez de sumir.

### 6. Agenda do painel: visão do profissional e walk-in

> O `CalendarView` que a F0.4 entregou é uma grade **semanal** própria, escrita do zero: o original dependia de `react-big-calendar` + `moment`, e `moment` é proibido (`contexto-comum.md` §2). Se esta tarefa precisar de visão de dia ou de mês, estenda o componente — **não** reintroduza a dependência.

**Área do Prestador (spec §2.3).** Visão do dia e da semana para o Staff, mobile-first, com os atendimentos e seus status (confirmado, pago, pendente, finalizado), e a ação de marcar como finalizado ou não compareceu. O Owner vê a agenda de qualquer profissional do tenant; o Staff, só a sua.

**Walk-in.** Staff e Owner criam agendamento pelo painel, com `source='WALK_IN'`, podendo passar por cima da antecedência mínima — mas **nunca** por cima do anti-overlap.

## Fora do escopo

Pagamento e checkout (F4), clube (F5), lembretes (F6).

## Critérios de aceite

1. Teste de concorrência: 20 requisições simultâneas no mesmo slot → exatamente 1 hold, 19 erros tratados.
2. Hold expira e o horário volta à grade sem intervenção.
3. Cancelamento dentro e fora da janela se comportam conforme a política do tenant.
4. Remarcação não deixa o horário antigo preso nem o novo duplicado.
5. Agendamento às 22h (Brasília) cai no dia certo — teste explícito de fuso.
6. Portal do tenant A não expõe dado de cliente do tenant B em nenhuma resposta de API.
7. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Validar disponibilidade só na aplicação.** A garantia é a constraint; o `if` é só para mensagem bonita.
- **Hold sem dono.** Amarre o hold à sessão/dispositivo, senão um bot segura a agenda inteira do salão por 10 minutos.
- **"Qualquer profissional" sempre no primeiro da lista.** Concentra tudo em uma pessoa; distribua.

---

## Tarefas

F3.1 e F3.2 são domínio puro e testável — bons candidatos a rodar em paralelo enquanto a UI espera.

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F3.0** ⟨T0⟩ | Portal público `/[slug]`: SSR com tema do tenant (com defaults), catálogo, shell mobile-first, página de tenant inválido | `app/[slug]/(portal)/**`, `components/portal/**`, `lib/theme/resolve.ts` | F1 | 2 |
| **F3.1** | Grade de disponibilidade: jornada, bloqueios, buffer, antecedência, "qualquer profissional" com distribuição, fuso do tenant | `lib/booking/availability.ts` | **F0** (domínio puro, não espera o portal) | 3 |
| **F3.2** | Hold de 10 min: transação, limpeza de vencidos, tradução do erro `23P01`, cron de expiração, **e os dois pontos de extensão do item 3.1** | `lib/booking/hold.ts`, `lib/booking/confirm.ts`, `lib/booking/participants/`, `app/api/cron/expire-holds/**` | **F0** (não espera o portal) | 3,5 |
| **F3.3** | Fluxo de agendamento na UI, com OTP **no fim** e contador de expiração do hold | `app/[slug]/agendar/**` | F3.1, F3.2 | 3 |
| **F3.4** | Área do cliente: próximos, histórico, cancelar e remarcar pela política | `app/[slug]/minha-conta/**` | F3.2 | 2,5 |
| **F3.5** | Agenda do painel: visão dia/semana do profissional com status (spec §2.3) + agendamento walk-in | `app/(dashboard)/painel/agenda/**` | F3.2, F2.0 | 4 |
