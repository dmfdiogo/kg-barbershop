-- Lançamentos de estorno (F4.3).
--
-- O schema da F0 foi congelado para que as fases paralelas não disputassem
-- migrations; a F4.3 é a última tarefa da fase 4 e nenhuma outra escreve aqui.
-- O que a F4.0/F4.1 não modelaram foi o ESTORNO: `Payment.status` muda para
-- REFUNDED/PARTIALLY_REFUNDED, mas o valor de cada estorno não cabe num booleano
-- nem num contador — um estorno parcial pode se repetir. Daí uma tabela
-- append-only, no mesmo espírito do `credit_ledger` (saldo é a soma de linhas).
--
-- A linha é criada pelo processador do webhook da F4.0, numa transação junto com
-- o `webhook_event` (provider, event_id) único: reentrega não duplica o
-- lançamento. RLS FORCE obrigatória como em toda tabela de negócio.

-- CreateTable
CREATE TABLE "refund" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_tenant_id_created_at_idx" ON "refund"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_payment_id_idx" ON "refund"("payment_id");

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security: mesma policy das demais tabelas com tenant_id.
-- current_setting(..., true) devolve NULL sem o GUC e a comparação filtra a
-- linha — a query sem escopo falha fechado. O único bypass é
-- `app.is_platform_admin = 'true'` (asPlatformAdmin).
ALTER TABLE "refund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refund" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "refund"
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)
  );
