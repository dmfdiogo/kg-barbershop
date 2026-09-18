-- SQL cru que o Prisma não gera: extensão, exclusion constraint de agenda e RLS.
--
-- Ordem: extensão -> anti-overlap -> RLS. Tudo aqui é parte do schema congelado
-- da F0; nenhuma fase seguinte precisa (nem deve) tocar nesta migration.
--
-- Nomes em snake_case: o schema mapeia todos os modelos/campos com @@map/@map,
-- então não há aspas duplas nem camelCase em sessão de psql, $queryRaw ou BI.

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
-- O intervalo é [starts_at, blocked_until), onde blocked_until = ends_at +
-- buffer do serviço: o buffer entre atendimentos também é garantido pelo banco.
-- Só HOLD, PENDING e CONFIRMED ocupam a agenda; COMPLETED/CANCELLED/NO_SHOW
-- deixam o intervalo livre.
ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, blocked_until, '[)') WITH &&
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
    'tenant',
    'tenant_member',
    'staff_profile',
    'working_hours',
    'time_off',
    'service',
    'staff_service',
    'booking',
    'payment',
    'asaas_account',
    'platform_sub',
    'membership_plan',
    'membership_benefit',
    'membership',
    'credit_ledger',
    'messaging_pref',
    'notification_job',
    'audit_log'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

-- tenant não tem coluna tenant_id: a chave do isolamento é o próprio id.
-- Sem esta policy, qualquer query escopada enxergaria todos os estabelecimentos.
CREATE POLICY tenant_isolation ON tenant
  USING (
    current_setting('app.is_platform_admin', true) = 'true'
    OR id = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.is_platform_admin', true) = 'true'
    OR id = current_setting('app.current_tenant', true)
  );

-- Demais tabelas de negócio: todas carregam tenant_id (contexto-comum.md §3.3),
-- inclusive as join tables — é o que dispensa alcançar o tenant por join.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'tenant_member',
    'staff_profile',
    'working_hours',
    'time_off',
    'service',
    'staff_service',
    'booking',
    'payment',
    'asaas_account',
    'platform_sub',
    'membership_plan',
    'membership_benefit',
    'membership',
    'credit_ledger',
    'messaging_pref',
    'notification_job',
    'audit_log'
  ]) LOOP
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON %I
        USING (
          current_setting('app.is_platform_admin', true) = 'true'
          OR tenant_id = current_setting('app.current_tenant', true)
        )
        WITH CHECK (
          current_setting('app.is_platform_admin', true) = 'true'
          OR tenant_id = current_setting('app.current_tenant', true)
        )
    $policy$, t);
  END LOOP;
END
$$;

-- Tabelas globais (user, otp_challenge, rate_limit_counter, webhook_event) NÃO
-- têm RLS nem tenant_id por decisão do plano §4: identidade é global (um
-- telefone pertence a vários salões) e essas tabelas são infraestrutura, não
-- negócio. O acesso a PII de user continua sendo responsabilidade da camada de
-- aplicação, que só deve consultá-la a partir de relações já escopadas por
-- tenant (ex.: booking -> customer -> user).
