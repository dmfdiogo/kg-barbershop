-- Um HOLD anônimo não tem cliente.
--
-- O soft lock de 10 minutos nasce ANTES da identificação por OTP, de propósito:
-- pedir login antes de mostrar horário derruba conversão (spec §2.4). Até a
-- F3.3, a única saída sem mexer no schema era inventar um "cliente visitante"
-- por tenant — uma pessoa falsa que vazaria para o painel do dono, para o envio
-- de mensagens, para o clube e para a exportação LGPD.
--
-- Modelar a ausência é mais honesto, e a constraint garante que a ausência só
-- vale enquanto o agendamento é hold: em qualquer outro status o cliente é
-- obrigatório.
ALTER TABLE booking ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE booking ADD CONSTRAINT booking_customer_required
  CHECK (status = 'HOLD' OR customer_id IS NOT NULL);
