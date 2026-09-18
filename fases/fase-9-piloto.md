# Fase 9 — Piloto

> **Depende de:** F8 · **Estimativa:** 14 dias · **Não é tarefa de agente autônomo** — é operação com clientes reais. Fica aqui para o roadmap ficar completo.

## Objetivo

3 a 5 estabelecimentos reais operando de verdade (spec §8), com dinheiro real e clientes reais.

## Antes de começar

- [ ] Decisões de produto pendentes fechadas (`../plano-refatoracao.md` §9): nome/domínio, percentual da taxa, política de estorno, NFS-e, sinal para assinante do clube.
- [ ] LGPD: política de privacidade publicada, retenção definida, caminho de exclusão de dados funcionando, `AuditLog` ativo.
- [ ] Termos de uso do SaaS e contrato com o estabelecimento.
- [ ] Backup automático do banco **testado com restauração real** — não basta existir.
- [ ] Monitoramento e alerta de erro em produção.
- [ ] Canal de suporte direto com os pilotos (grupo de WhatsApp resolve).
- [ ] Plano de rollback para cada integração.

## Critérios de saída (o que prova que o piloto deu certo)

1. Um dono faz o onboarding sozinho, sem ajuda, em menos de 10 minutos (spec §9.2).
2. Zero double-booking no período — a métrica que o desenho todo protege.
3. Queda mensurável de no-show onde o sinal está ativo (é a proposta de valor central da spec).
4. Taxa de entrega de OTP e de lembretes acima do aceitável, com o que falhou explicado.
5. Todo repasse financeiro conferido: o que o salão recebeu bate com o que o extrato do provider diz.
6. Nenhum incidente de vazamento entre tenants.
7. Lista priorizada do que impede o próximo cliente de entrar sem ajuda humana.
