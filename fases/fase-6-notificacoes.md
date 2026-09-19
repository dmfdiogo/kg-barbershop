# Fase 6 — Notificações e automações (contra mock)

> **Depende de:** F3 · **Estimativa:** 10,5 dias · **Paralelismo:** pode rodar junto com F4 e F7.
> **Leia antes:** [`contexto-comum.md`](contexto-comum.md) §5, spec §4.

## Objetivo

Toda a máquina de comunicação — agendamento, envio, retentativa, log e preferências — contra `MockWhatsAppProvider`. Na F8 entra o provider real e nenhuma regra muda.

## Escopo

> **`lib/messaging/templates.ts` já existe**, criado na F0.3: o mock precisa dele para recusar template não registrado. Ele traz os 9 templates da spec §4 com nome, categoria e variáveis. **Você assume a propriedade** e o evolui — não recrie. Os nomes são proposta, não contrato: quem fixa é a aprovação da Meta na F8.3.

### 1. Trabalhos persistidos

Lembretes viram linhas em `NotificationJob` criadas ao reagir aos eventos `BookingConfirmed` / `BookingCancelled` da F3.2 (ver `fase-3-portal-booking.md` §3.1) — **pós-commit**, porque WhatsApp fora do ar não pode impedir alguém de marcar horário. Os jobs são executadas por `/api/cron/send-notifications` a cada 5 minutos, com janela de tolerância e marcação de envio.

**`setTimeout` não sobrevive a deploy em ambiente serverless.** Se o lembrete D-1 depende de um timer em memória, ele simplesmente não acontece.

### 2. Templates da spec §4

- OTP (F1 já usa) — categoria *authentication*.
- Confirmação imediata: data, hora, profissional, endereço, link do Google Maps.
- **D-1** (24h antes) com botão de confirmação de presença — e o retorno do clique atualizando o agendamento.
- **H-2** (2h antes), curto.
- Cancelamento e remarcação, para cliente **e** profissional.
- Novo agendamento, para o profissional.

Cada template é declarado em um registro central com nome, categoria e variáveis. O mock recusa envio de template não registrado — é o que garante que a aprovação da Meta na F8 não vire retrabalho.

### 3. Regras de envio

- Idempotência: um `NotificationJob` envia **uma** vez, mesmo com cron sobreposto.
- Agendamento cancelado cancela os lembretes pendentes (nada pior que lembrete de consulta cancelada).
- Agendamento criado com menos de 24h não gera D-1; com menos de 2h não gera H-2.
- Silêncio noturno configurável (não mandar H-2 às 4h da manhã para um horário das 6h).
- Retentativa com backoff, limite de tentativas e estado final de falha visível no painel.
- Log de entrega (`providerMessageId`, status) — no piloto, "o cliente diz que não recebeu" vai acontecer.

### 4. Preferências e direitos do titular (LGPD)

Opt-out por cliente, respeitado em tudo que não for transacional crítico. Registro de consentimento.

**E os direitos do titular**, que até agora só apareciam como item de checklist do piloto e não eram tarefa de ninguém: exportação dos dados do cliente e **caminho de exclusão funcionando** (o que é apagado, o que é anonimizado por obrigação fiscal — um agendamento pago não pode sumir do extrato — e em quanto tempo). Sem isso não se abre o piloto com cliente real.

### 5. Web Push — ADIADO (decisão de 19/09/2026)

**Não foi implementado, e a não-entrega é a entrega correta.** A F6.3 levantou o que o recurso exige e o custo não cabe numa folha:

1. tabela nova para as inscrições (mudança de schema);
2. service worker e manifest — o PWA que [`plano-refatoracao.md`](../plano-refatoracao.md) §2.2 registra como inexistente;
3. tela de opt-in do profissional, em arquivos de outras tarefas;
4. ligação pós-commit no arquivo da F6.1;
5. a dependência `web-push` ou criptografia VAPID escrita à mão;
6. configuração VAPID com falha cedo em produção;
7. integração com o opt-out da F6.2.

**Por que adiar em vez de simular:** um mock de push guardaria a inscrição num store que some no deploy, e o profissional pararia de olhar a agenda achando que seria avisado. Alerta que não chega é pior que alerta que não existe.

**O requisito não fica descoberto:** a spec §2.3 pede alerta ao prestador por WhatsApp **e** push; a F6.1 já envia "novo agendamento" e "cancelamento" ao profissional por WhatsApp. O push é redundância de canal, não a única via — e não é pré-requisito do piloto.

**Quando retomar:** vira tarefa própria, com schema e PWA no escopo, depois do piloto.

### 5.1. Escopo original (mantido para quando a tarefa for retomada)

Alertas ao profissional para novo agendamento e cancelamento. Se o custo de implementação estourar a fase, **entregue o WhatsApp completo e registre o push como pendência** — não entregue os dois pela metade.

## Fora do escopo

Cloud API real, verificação do Meta Business, aprovação de templates (F8).

## Critérios de aceite

1. Agendar → confirmação no `/dev/outbox`; avançar o relógio → D-1 e H-2 na ordem certa.
2. Cron rodando duas vezes não envia duas vezes.
3. Cancelar agendamento cancela os lembretes pendentes.
4. Template não registrado é recusado pelo mock (teste explícito).
5. Opt-out bloqueia o que deve bloquear e preserva o que é transacional.
6. Mensagem de um tenant nunca é enviada com dados de outro.
7. DoD de `contexto-comum.md` §8.

## Armadilhas conhecidas

- **Cron sobreposto.** Execução longa + intervalo curto = dois workers pegando o mesmo job. Use lock ou `UPDATE ... RETURNING` para reivindicar.
- **Fuso no agendamento do job.** "24h antes" é sobre o horário local do tenant.
- **Texto livre.** A API oficial só permite template fora da janela de 24h. Escrever mensagem livre agora é código que a F8 joga fora.

---

## Tarefas

| ID | Tarefa | Dono dos arquivos | Depende | Dias |
| :--- | :--- | :--- | :--- | :--- |
| **F6.0** ⟨T0⟩ | Registro central de templates, `NotificationJob`, runner com lock (sem envio duplicado), cron, retry com backoff | `lib/messaging/{jobs,templates}.ts`, `app/api/cron/send-notifications/**` | F3 | 3 |
| **F6.1** | Gatilhos: confirmação, D-1 com botão, H-2, cancelamento, remarcação, aviso ao profissional; cancelar jobs pendentes | `lib/messaging/triggers.ts` | F6.0 | 2,5 |
| **F6.2** | Opt-out, consentimento, **exportação e exclusão de dados do titular** e log de entrega no painel | `app/(dashboard)/painel/mensagens/**`, `lib/messaging/preferences.ts`, `lib/privacy/**` | F6.0 | 3 |
| **F6.3** | Web Push para o profissional *(opcional — só se não comprometer o resto)* | `lib/push/**` | F6.0 | 2 |
