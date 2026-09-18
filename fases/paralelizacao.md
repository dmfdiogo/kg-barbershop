# Paralelização: quantos agentes, e quem mexe em quê

## Resposta curta

| | Agentes |
| :--- | :--- |
| Teto pelo grafo de dependências (só fases) | **3** |
| Teto quebrando fases em tarefas | **7 a 9** no pico |
| **Recomendado com um revisor humano** | **3 a 4** |
| Mínimo em ondas de tronco (F0.1, F1.0, cada T0) | **1** |

O limite real não é o grafo: é **quanto código você consegue revisar e mesclar por dia**. Quatro agentes produzem quatro PRs; se eles ficam três dias na fila, o paralelismo virou desperdício com aparência de velocidade. Comece com 2, suba para 4 quando o ritmo de revisão se firmar.

---

## 1. Duas granularidades diferentes

- **Fase** (`fase-N-*.md`) = marco do roadmap. 8 a 15 dias. **Não é** uma tarefa de agente.
- **Tarefa** (`FN.x`, listadas no fim de cada arquivo de fase) = uma unidade que um agente executa do início ao fim, com diff revisável. 1 a 3 dias.

São 42 tarefas no total. Um agente recebe **uma tarefa**, não uma fase.

## 2. Padrão tronco-e-folhas

Quase toda fase começa com uma tarefa **T0 (tronco)**, executada **sozinha**, que entrega o esqueleto e os contratos da fase: layout, tipos, assinaturas de server action, rotas vazias. Só depois as **folhas** entram em paralelo, cada uma compilando contra contratos que já existem.

Sem isso, três agentes inventam três versões do mesmo layout e do mesmo tipo, e a mesclagem vira reescrita.

## 3. Ondas

| Onda | Fases | Tarefas | Teto | Recomendado |
| :--- | :--- | :--- | :--- | :--- |
| 1 | F0 | 5 | 3 | 3 |
| 2 | F1 | 5 | 3 | 2 |
| 3 | F2 ‖ F3 | 12 | 7 | 4 |
| 4 | F4 ‖ F6 ‖ F7 | 12 | 9 | 4 |
| 5 | F5 | 4 | 2 | 2 |
| 6 | F8 | 4 | 3 | 3 |

A onda 6 é o paralelismo mais limpo do projeto: Stripe, Asaas e WhatsApp são três adaptadores, cada um em seu arquivo, sem nenhuma interseção.

## 4. Mapa de propriedade

A regra que torna tudo isto seguro: **num dado momento, cada arquivo tem exatamente um dono.** Um agente que precisa editar arquivo de outro **para e pede** — não edita "só uma linha".

| Área | Dono |
| :--- | :--- |
| `prisma/schema.prisma`, `prisma/migrations/` | **F0.2 e mais ninguém.** Congelado depois. |
| `lib/payments/types.ts`, `lib/messaging/types.ts` | F0.3; depois só o T0 da fase que precisar estender |
| `lib/tenant/` | F0.2, depois F1.0 |
| `middleware.ts` | F1.0 |
| `lib/auth/` | F1.0 (contratos), F1.1 (OTP) |
| `lib/booking/availability.ts` | F0.4, depois F3.1 |
| `components/` (compartilhados) | F0.4; alteração posterior exige pedido explícito |
| `app/(dashboard)/<feature>/` | a folha daquela feature |
| `app/[slug]/` | F3.0 e suas folhas |
| `app/(platform)/` | F7.3 |
| `lib/payments/asaas.ts` · `stripe.ts` · `lib/messaging/cloud-api.ts` | F8.1 · F8.2 · F8.3 |

### 4.1. Evite arquivos-lista

O que mais gera conflito não é lógica, é **arquivo central onde todo mundo acrescenta uma linha**: menu de navegação, índice de rotas, barril de exports, registro de templates, `i18n` num arquivo só.

Prefira **um arquivo por feature, descoberto automaticamente** (ex.: cada feature exporta seu item de menu em `app/(dashboard)/<feature>/nav.ts`, e o menu é montado varrendo a pasta). Onde isso não valer a pena, o arquivo-lista tem dono único e as folhas pedem a entrada a ele.

## 5. Regras de engajamento

1. **Uma worktree git por agente** (`git worktree add ../wt-f2-1 -b f2.1-servicos`). Dois agentes no mesmo diretório se sabotam.
2. **Tronco antes das folhas.** Nunca solte folhas antes do T0 mesclado.
3. **Contrato primeiro.** O T0 entrega os tipos e as assinaturas; as folhas implementam contra eles sem se enxergar.
4. **Branch de integração por onda** (`onda-3`), não direto na `main`. A `main` recebe a onda inteira, testada junta.
5. **Ordem de mesclagem = ordem de propriedade.** Quem mexeu em área compartilhada entra primeiro; folhas rebasam por cima.
6. **PR pequeno.** Tarefa que está gerando um diff gigante foi mal dimensionada — vale parar e dividir.
7. **Schema congelado.** Depois da F0, precisou mexer? Para e pergunta. É a regra que sustenta as ondas 3 e 4.

## 6. Prompt para abrir um agente

```
Você vai executar a tarefa <ID> do projeto kg-barbershop.

Leia, nesta ordem:
  1. spec-executiva.md
  2. plano-refatoracao.md
  3. fases/contexto-comum.md      <- regras obrigatórias, não são sugestões
  4. fases/paralelizacao.md       <- §4 (propriedade) e §5 (regras)
  5. fases/<arquivo da sua fase>  <- escopo, critérios de aceite, armadilhas
     e, no fim do arquivo, a linha da tarefa <ID>

Trabalhe apenas na sua worktree, na branch <branch>.
Você é dono apenas dos arquivos listados na sua tarefa. Precisou de outro:
pare e pergunte, não edite.
Não faça integração real com serviço externo (isso é a F8), não altere o
schema, não mude assinatura de port, não dê push nem abra PR sem pedido.
Entregue com o Definition of Done (contexto-comum.md §8) cumprido, incluindo
o teste de isolamento entre tenants.
Ao terminar, escreva um resumo do que ficou fora do escopo e por quê.
```

## 7. O gargalo é você

Antes de subir para 4 agentes, tenha resolvido:

- **CI verde obrigatório no PR** — senão você vira o compilador humano deles.
- **Revisão diária, em lote** — fila de PR parada é o custo real do paralelismo.
- **Um dono para a branch de integração** (pode ser um agente dedicado só a rebasar e manter a onda verde).

Se só der para revisar direito **dois** PRs por dia, rode dois agentes. Paralelismo acima da capacidade de revisão não entrega antes: acumula dívida que alguém mescla no escuro.
