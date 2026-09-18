-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('OWNER', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('FULL_PREPAID', 'DEPOSIT', 'ON_SITE');

-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('HOLD', 'PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "booking_source" AS ENUM ('PORTAL', 'WALK_IN');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('PIX', 'CARD', 'CASH');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "billing_plan" AS ENUM ('SOLO', 'EQUIPE', 'PRO');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "membership_cycle" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUALLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "messaging_channel" AS ENUM ('WHATSAPP', 'PUSH', 'EMAIL');

-- CreateTable
CREATE TABLE "tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "custom_domain" TEXT,
    "name" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "logo_url" TEXT,
    "color_primary" TEXT,
    "color_secondary" TEXT,
    "color_background" TEXT,
    "theme_preset" TEXT,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 24,
    "status" "tenant_status" NOT NULL DEFAULT 'TRIAL',
    "trial_bookings_used" INTEGER NOT NULL DEFAULT 0,
    "min_advance_minutes" INTEGER NOT NULL DEFAULT 0,
    "max_advance_minutes" INTEGER,
    "no_show_policy_text" TEXT,
    "membership_requires_deposit" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_member" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "member_role" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profile" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tenant_member_id" TEXT NOT NULL,
    "bio" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" TIME(0) NOT NULL,
    "end_time" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_off" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "buffer_min" INTEGER NOT NULL DEFAULT 0,
    "price_cents" INTEGER NOT NULL,
    "payment_mode" "payment_mode" NOT NULL DEFAULT 'ON_SITE',
    "deposit_cents" INTEGER,
    "deposit_percent" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_service" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "status" "booking_status" NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(3),
    "hold_session_id" TEXT,
    "price_cents" INTEGER NOT NULL,
    "source" "booking_source" NOT NULL DEFAULT 'PORTAL',
    "confirmed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "no_show_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "asaas_id" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asaas_account" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "asaas_account_id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "api_key_enc" TEXT NOT NULL,
    "pix_key" TEXT NOT NULL,
    "kyc_status" "kyc_status" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "asaas_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sub" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "plan" "billing_plan" NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'TRIALING',
    "current_period_end" TIMESTAMPTZ(3),
    "trial_ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_sub_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_plan" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "cycle" "membership_cycle" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_benefit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "quantity_per_cycle" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_benefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "asaas_subscription_id" TEXT,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "current_period_end" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "booking_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenge" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_counter" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_counter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_pref" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "messaging_channel" NOT NULL,
    "opted_out_at" TIMESTAMPTZ(3),
    "consent_at" TIMESTAMPTZ(3),
    "consent_source" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messaging_pref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_job" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "booking_id" TEXT,
    "template" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMPTZ(3),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_custom_domain_key" ON "tenant"("custom_domain");

-- CreateIndex
CREATE UNIQUE INDEX "user_phone_key" ON "user"("phone");

-- CreateIndex
CREATE INDEX "tenant_member_tenant_id_role_idx" ON "tenant_member"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "tenant_member_user_id_idx" ON "tenant_member"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_member_tenant_id_user_id_key" ON "tenant_member"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profile_tenant_member_id_key" ON "staff_profile"("tenant_member_id");

-- CreateIndex
CREATE INDEX "staff_profile_tenant_id_active_idx" ON "staff_profile"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "working_hours_tenant_id_staff_id_weekday_idx" ON "working_hours"("tenant_id", "staff_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_staff_id_weekday_start_time_key" ON "working_hours"("staff_id", "weekday", "start_time");

-- CreateIndex
CREATE INDEX "time_off_tenant_id_staff_id_starts_at_idx" ON "time_off"("tenant_id", "staff_id", "starts_at");

-- CreateIndex
CREATE INDEX "service_tenant_id_active_idx" ON "service"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "staff_service_tenant_id_idx" ON "staff_service"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_service_staff_id_service_id_key" ON "staff_service"("staff_id", "service_id");

-- CreateIndex
CREATE INDEX "booking_tenant_id_starts_at_idx" ON "booking"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "booking_tenant_id_status_starts_at_idx" ON "booking"("tenant_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "booking_staff_id_starts_at_idx" ON "booking"("staff_id", "starts_at");

-- CreateIndex
CREATE INDEX "booking_customer_id_idx" ON "booking"("customer_id");

-- CreateIndex
CREATE INDEX "payment_tenant_id_status_idx" ON "payment"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "payment_booking_id_idx" ON "payment"("booking_id");

-- CreateIndex
CREATE INDEX "payment_asaas_id_idx" ON "payment"("asaas_id");

-- CreateIndex
CREATE UNIQUE INDEX "asaas_account_tenant_id_key" ON "asaas_account"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sub_tenant_id_key" ON "platform_sub"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_sub_status_idx" ON "platform_sub"("status");

-- CreateIndex
CREATE INDEX "membership_plan_tenant_id_active_idx" ON "membership_plan"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "membership_benefit_tenant_id_idx" ON "membership_benefit"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "membership_benefit_plan_id_service_id_key" ON "membership_benefit"("plan_id", "service_id");

-- CreateIndex
CREATE INDEX "membership_tenant_id_status_idx" ON "membership"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "membership_customer_id_idx" ON "membership"("customer_id");

-- CreateIndex
CREATE INDEX "credit_ledger_tenant_id_membership_id_idx" ON "credit_ledger"("tenant_id", "membership_id");

-- CreateIndex
CREATE INDEX "credit_ledger_membership_id_idx" ON "credit_ledger"("membership_id");

-- CreateIndex
CREATE INDEX "otp_challenge_phone_expires_at_idx" ON "otp_challenge"("phone", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_counter_key_key" ON "rate_limit_counter"("key");

-- CreateIndex
CREATE INDEX "rate_limit_counter_expires_at_idx" ON "rate_limit_counter"("expires_at");

-- CreateIndex
CREATE INDEX "messaging_pref_user_id_idx" ON "messaging_pref"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_pref_tenant_id_user_id_channel_key" ON "messaging_pref"("tenant_id", "user_id", "channel");

-- CreateIndex
CREATE INDEX "notification_job_status_scheduled_for_idx" ON "notification_job"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notification_job_tenant_id_booking_id_idx" ON "notification_job"("tenant_id", "booking_id");

-- CreateIndex
CREATE INDEX "webhook_event_provider_processed_at_idx" ON "webhook_event"("provider", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_provider_event_id_key" ON "webhook_event"("provider", "event_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- AddForeignKey
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_member" ADD CONSTRAINT "tenant_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profile" ADD CONSTRAINT "staff_profile_tenant_member_id_fkey" FOREIGN KEY ("tenant_member_id") REFERENCES "tenant_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service" ADD CONSTRAINT "service_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_service" ADD CONSTRAINT "staff_service_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "tenant_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asaas_account" ADD CONSTRAINT "asaas_account_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_sub" ADD CONSTRAINT "platform_sub_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_plan" ADD CONSTRAINT "membership_plan_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_benefit" ADD CONSTRAINT "membership_benefit_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_benefit" ADD CONSTRAINT "membership_benefit_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_benefit" ADD CONSTRAINT "membership_benefit_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "tenant_member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership" ADD CONSTRAINT "membership_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "membership_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_pref" ADD CONSTRAINT "messaging_pref_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_pref" ADD CONSTRAINT "messaging_pref_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_job" ADD CONSTRAINT "notification_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_job" ADD CONSTRAINT "notification_job_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

