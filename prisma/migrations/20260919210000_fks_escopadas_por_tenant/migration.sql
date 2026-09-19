-- FKs escopadas por tenant: a chave estrangeira carrega o `tenant_id`.
--
-- A RLS valida o `tenant_id` da própria linha, não a procedência do id que ela
-- referencia, e a checagem de FK do Postgres roda como dono da tabela,
-- ignorando RLS. Sem isto, uma linha `(tenant_id = A, service_id = <serviço de
-- B>)` era aceita pelo banco. Os ids trafegam em formulário (`/agendar?
-- servico=…`) e o portal de qualquer salão é público, então o id do vizinho
-- não é segredo. A validação na aplicação já barrava; esta é a segunda camada.
--
-- FICAM DE FORA, de propósito, as três FKs opcionais com ON DELETE SET NULL
-- (`booking.customer_id`, `credit_ledger.booking_id`,
-- `notification_job.booking_id`): numa chave composta o Postgres tentaria
-- anular o `tenant_id` junto, que é NOT NULL. A forma correta
-- (`ON DELETE SET NULL (coluna)`, PG 15+) o Prisma não sabe escrever, e à mão
-- deixaria desvio permanente a cada `migrate dev`. Nenhuma das três nasce de
-- entrada do usuário.
--
-- Os uniques `(tenant_id, id)` são exigência do Postgres para que a composta
-- possa apontar para eles. Não restringem nada: `id` já é chave primária.


-- DropForeignKey
ALTER TABLE "booking" DROP CONSTRAINT "booking_service_id_fkey";

-- DropForeignKey
ALTER TABLE "booking" DROP CONSTRAINT "booking_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_membership_id_fkey";

-- DropForeignKey
ALTER TABLE "credit_ledger" DROP CONSTRAINT "credit_ledger_service_id_fkey";

-- DropForeignKey
ALTER TABLE "membership" DROP CONSTRAINT "membership_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "membership" DROP CONSTRAINT "membership_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "membership_benefit" DROP CONSTRAINT "membership_benefit_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "membership_benefit" DROP CONSTRAINT "membership_benefit_service_id_fkey";

-- DropForeignKey
ALTER TABLE "payment" DROP CONSTRAINT "payment_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "refund" DROP CONSTRAINT "refund_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_profile" DROP CONSTRAINT "staff_profile_tenant_member_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_service" DROP CONSTRAINT "staff_service_service_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_service" DROP CONSTRAINT "staff_service_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "time_off" DROP CONSTRAINT "time_off_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "working_hours" DROP CONSTRAINT "working_hours_staff_id_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "booking_tenant_id_id_key" ON "booking"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_tenant_id_id_key" ON "membership"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_plan_tenant_id_id_key" ON "membership_plan"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_tenant_id_id_key" ON "payment"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_tenant_id_id_key" ON "service"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_tenant_id_id_key" ON "staff_profile"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_tenant_id_tenant_member_id_key" ON "staff_profile"("tenant_id", "tenant_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_member_tenant_id_id_key" ON "tenant_member"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_tenant_id_tenant_member_id_fkey" FOREIGN KEY ("tenant_id", "tenant_member_id") REFERENCES "tenant_member"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profile"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profile"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profile"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "service"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_staff_id_fkey" FOREIGN KEY ("tenant_id", "staff_id") REFERENCES "staff_profile"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_booking_id_fkey" FOREIGN KEY ("tenant_id", "booking_id") REFERENCES "booking"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_tenant_id_payment_id_fkey" FOREIGN KEY ("tenant_id", "payment_id") REFERENCES "payment"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_benefit" ADD CONSTRAINT "membership_benefit_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "membership_plan"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_benefit" ADD CONSTRAINT "membership_benefit_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "service"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "tenant_member"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_plan_id_fkey" FOREIGN KEY ("tenant_id", "plan_id") REFERENCES "membership_plan"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "membership"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_service_id_fkey" FOREIGN KEY ("tenant_id", "service_id") REFERENCES "service"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

