-- Preço contratado do clube, congelado na assinatura (F5).
--
-- `membership.contracted_price_cents` existe para que reajustar um plano não
-- reajuste quem já assinou. A coluna é NOT NULL de propósito: uma assinatura
-- sem preço contratado cobraria o preço corrente do plano, que é exatamente o
-- comportamento que se quer impedir. O backfill copia o preço vigente do plano
-- para as linhas que já existem — para elas, contratado e corrente coincidem.

-- Corrige um desvio: quando `booking.customer_id` virou opcional (hold anônimo),
-- a FK continuou com o comportamento da coluna obrigatória. O schema declara a
-- relação como opcional, logo SET NULL. Na prática quase nunca dispara: a
-- exclusão do titular (F6.2) anonimiza o vínculo em vez de apagá-lo, e a
-- constraint `booking_customer_required` barra deixar sem cliente um
-- agendamento que não seja HOLD.
ALTER TABLE "booking" DROP CONSTRAINT "booking_customer_id_fkey";
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "tenant_member"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "membership"
  ADD COLUMN "card_brand" TEXT,
  ADD COLUMN "card_last_four" TEXT,
  ADD COLUMN "card_token" TEXT,
  ADD COLUMN "contracted_price_cents" INTEGER;

UPDATE "membership" m
   SET "contracted_price_cents" = p."price_cents"
  FROM "membership_plan" p
 WHERE p."id" = m."plan_id";

ALTER TABLE "membership" ALTER COLUMN "contracted_price_cents" SET NOT NULL;
