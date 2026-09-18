# Fases de execução

Cada arquivo desta pasta é uma **unidade de trabalho autocontida**, escrita para ser entregue a um agente autônomo sem depender do histórico de conversa que gerou o plano.

Antes de executar qualquer fase, o agente **deve** ler:

1. [`../spec-executiva.md`](../spec-executiva.md) — o produto (fonte de verdade de escopo).
2. [`../plano-refatoracao.md`](../plano-refatoracao.md) — a estratégia da refatoração.
3. [`contexto-comum.md`](contexto-comum.md) — as regras técnicas que valem para **todas** as fases. Não são sugestões.
4. [`paralelizacao.md`](paralelizacao.md) §4 e §5 — de quais arquivos ele é dono e o que não pode tocar.
5. O arquivo da sua própria fase, incluindo a linha da sua tarefa na tabela final.

## Estratégia: mock primeiro, integração depois

WhatsApp, Asaas e Stripe dependem de ações humanas com prazo imprevisível (verificação do Meta Business, KYC de subconta, criação de conta). Por isso **todo o produto é construído contra interfaces com implementação mock**, e as integrações reais entram em uma fase única no final (F8).

Os mocks não são stubs preguiçosos: validam as mesmas regras que o serviço real valida e disparam os mesmos webhooks. Ver `contexto-comum.md` §5.

## Ordem e paralelização

**Uma fase não é uma tarefa de agente.** Fase é marco de roadmap (8 a 15 dias); tarefa é o que um agente executa de ponta a ponta (1 a 3 dias). As 9 fases se decompõem em **42 tarefas**, listadas no fim de cada arquivo de fase.

[`paralelizacao.md`](paralelizacao.md) tem o mapa completo: quantos agentes cabem em cada onda, quem é dono de quais arquivos e as regras de mesclagem. **Leia antes de disparar mais de um agente ao mesmo tempo.**

[`prompts.md`](prompts.md) tem os **42 prompts prontos para colar**, um por tarefa — também em arquivos individuais em [`prompts/`](prompts/). O topo do arquivo traz os cuidados específicos para agentes fora do Claude Code (DeepSeek e afins).

```
Onda 1   F0                          3 agentes   (após F0.1, que roda sozinha)
Onda 2   F1.0  ‖  F3.1  ‖  F3.2       3 agentes   (F3.1/F3.2 são domínio puro)
Onda 2b  F1.1..F1.4                  3 agentes   (após F1.0)
Onda 3   F2  ‖  F3                   4 agentes
Onda 4   F4  ‖  F6  ‖  F7            4 agentes
Onda 5   F5                          2 agentes
Onda 6   F8                          3 agentes   (um por integração)
         F9  Piloto                  operacional, não é tarefa de agente
```

Os números acima são o **recomendado para um revisor humano**; o teto pelo grafo é maior (7 a 9 no pico) e está em `paralelizacao.md` §3. O gargalo real é revisão e mesclagem, não dependência.

Duas regras tornam isso seguro, e estão detalhadas em `paralelizacao.md`:

1. **O schema inteiro nasce na F0.** Fases simultâneas nunca criam migrations concorrentes. Quem achar que precisa mexer no schema **para e pergunta**.
2. **Cada arquivo tem um dono por vez.** Toda fase começa por uma tarefa de tronco ⟨T0⟩, sozinha, que entrega layout e contratos; só então as folhas entram em paralelo.

| Fase | Arquivo | Dias | Depende de |
| :--- | :--- | :--- | :--- |
| F0 | [fase-0-fundacao.md](fase-0-fundacao.md) | 10 | — |
| F1 | [fase-1-multitenant-auth.md](fase-1-multitenant-auth.md) | 12 | F0 |
| F2 | [fase-2-painel-owner.md](fase-2-painel-owner.md) | 18 | F1 |
| F3 | [fase-3-portal-booking.md](fase-3-portal-booking.md) | 18 | F1 |
| F4 | [fase-4-pagamentos.md](fase-4-pagamentos.md) | 12,5 | F3 |
| F5 | [fase-5-clube-assinatura.md](fase-5-clube-assinatura.md) | 12,5 | F4 |
| F6 | [fase-6-notificacoes.md](fase-6-notificacoes.md) | 10,5 | F3 |
| F7 | [fase-7-billing-superadmin.md](fase-7-billing-superadmin.md) | 11 | F2 |
| F8 | [fase-8-integracoes-reais.md](fase-8-integracoes-reais.md) | 12 | F5, F6, F7 + ações do dono |
| F9 | [fase-9-piloto.md](fase-9-piloto.md) | 14 | F8 |

Caminho crítico: **≈ 93 dias** paralelizando só no nível de fase (F0 → F1 → F3 → F4 → F5 → F8 → F9), e **≈ 59 dias de esforço** paralelizando também dentro das fases — este último supondo agentes suficientes e revisão que não vira fila. Em série, 132,5.

> Números revisados em 18/09/2026: as estimativas por fase estavam menores que a soma das próprias tarefas em 6 das 9 fases, e faltavam escopos (agenda do profissional, direitos do titular, pontos de extensão do agendamento). Os totais acima já refletem a correção.
