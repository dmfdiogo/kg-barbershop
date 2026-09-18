-- SQL cru que o Prisma não gera: extensão, exclusion constraint de agenda e RLS.
--
-- Ordem: extensão -> anti-overlap -> RLS. Tudo aqui é parte do schema congelado
-- da F0; nenhuma fase seguinte precisa (nem deve) tocar nesta migration.

-- ===========================================================================
-- 1. btree_gist
-- ===========================================================================
-- O init do volume do docker-compose já cria esta extensão, mas em CI e em
-- produção (Neon/Supabase) o banco é outro. CREATE EXTENSION exige superuser
-- ou papel com privilégio equivalente; é o primeiro comando da migration por
-- isso.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===========================================================================
-- 2. Anti double-booking (plano-refatoracao.md §5.1)
-- ===========================================================================
-- A garantia de "um slot por profissional" não depende de if em JavaScript.
-- O intervalo é [startsAt, blockedUntil), onde blockedUntil = endsAt + buffer
-- do serviço: o buffer entre atendimentos também é garantido pelo banco.
-- Só HOLD, PENDING e CONFIRMED ocupam a agenda; COMPLETED/CANCELLED/NO_SHOW
-- deixam o intervalo livre.
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    "staffId" WITH =,
    tstzrange("startsAt", "blockedUntil", '[)') WITH &&
  )
  WHERE (status IN ('HOLD', 'PENDING', 'CONFIRMED'));

-- ===========================================================================
-- 3. Row Level Security (contexto-comum.md §4)
-- ===========================================================================
-- Duas camadas de isolamento, e as duas são obrigatórias:
--   1. aplicação: lib/tenant/db.ts abre transação e executa
--      set_config('app.current_tenant', <tenantId>, true) antes das queries;
--   2. banco: as policies abaixo, que comparam o GUC `app.current_tenant`.
--
-- current_setting(..., true) devolve NULL quando o GUC não foi setado; a
-- comparação com NULL filtra a linha, então a policy falha FECHADO — query
-- esquecida não vaza dado de outro tenant, devolve vazio.
--
-- O único bypass é `app.is_platform_admin = 'true'`, setado exclusivamente por
-- asPlatformAdmin() (lib/tenant/db.ts) — nunca implícito.
--
-- FORCE ROW LEVEL SECURITY é obrigatório: sem ele, o dono da tabela (o papel
-- que o Prisma Migrate usa, na maioria dos bancos gerenciados) ignora as
-- policies. Superuser do Postgres continua bypassando por definição — por isso
-- os testes de isolamento rodam com uma role NÃO-superuser, criada no setup.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'Tenant',
    'TenantMember',
    'StaffProfile',
    'WorkingHours',
    'TimeOff',
    'Service',
    'StaffService',
    'Booking',
    'Payment',
    'AsaasAccount',
    'PlatformSub',
    'MembershipPlan',
    'MembershipBenefit',
    'Membership',
    'CreditLedger',
    'MessagingPref',
    'NotificationJob',
    'AuditLog'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- Tenant não tem coluna "tenantId": a chave do isolamento é o próprio "id".
-- Sem esta policy, qualquer query escopada enxergaria todos os estabelecimentos.
CREATE POLICY tenant_isolation ON "Tenant"
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR "id" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR "id" = current_setting('app.current_tenant', true)
  );

-- Demais tabelas de negócio: todas carregam tenantId (contexto-comum.md §3.3),
-- inclusive as join tables — é o que dispensa alcançar o tenant por join.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'TenantMember',
    'StaffProfile',
    'WorkingHours',
    'TimeOff',
    'Service',
    'StaffService',
    'Booking',
    'Payment',
    'AsaasAccount',
    'PlatformSub',
    'MembershipPlan',
    'MembershipBenefit',
    'Membership',
    'CreditLedger',
    'MessagingPref',
    'NotificationJob',
    'AuditLog'
  ]) LOOP
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.is_platform_admin', true) = 'true'
          OR "tenantId" = current_setting('app.current_tenant', true)
        )
        WITH CHECK (
          current_setting('app.is_platform_admin', true) = 'true'
          OR "tenantId" = current_setting('app.current_tenant', true)
        )
    $policy$, t);
  END LOOP;
END
$$;

-- Tabelas globais (User, OtpChallenge, RateLimitCounter, WebhookEvent) NÃO têm
-- RLS nem tenantId por decisão do plano §4: identidade é global (um telefone
-- pertence a vários salões) e essas tabelas são infraestrutura, não negócio.
-- O acesso a PII de User continua sendo responsabilidade da camada de
-- aplicação, que só deve consultá-la a partir de relações já escopadas por
-- tenant (ex.: Booking -> customer -> user).
