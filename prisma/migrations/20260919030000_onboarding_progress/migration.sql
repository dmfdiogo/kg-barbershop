-- Onboarding guiado do dono (F2.5).
--
-- A migration de RLS da F0 é CONGELADA ("nenhuma fase seguinte precisa nem deve
-- tocar nela"). Por isso a tabela nova nasce com a própria policy de isolamento
-- aqui, no mesmo formato: FORCE RLS + comparação com `app.current_tenant`,
-- falhando fechado quando o GUC não está setado. O bypass continua sendo só o
-- `app.is_platform_admin` explícito (`asPlatformAdmin()`).

-- CreateEnum
CREATE TYPE "onboarding_step" AS ENUM ('ESTABLISHMENT', 'HOURS', 'SERVICE', 'PORTAL');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('AWAITING_ACTIVATION', 'ACTIVE', 'REJECTED');

-- CreateTable
CREATE TABLE "onboarding_progress" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "completed_steps" "onboarding_step"[],
    "pix_key" TEXT,
    "payout_status" "payout_status" NOT NULL DEFAULT 'AWAITING_ACTIVATION',
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_progress_tenant_id_key" ON "onboarding_progress"("tenant_id");

-- AddForeignKey
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security (mesma regra da migration 20260918143000)
ALTER TABLE "onboarding_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_progress" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "onboarding_progress"
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR tenant_id = current_setting('app.current_tenant', true)
  );
