-- =====================================================================
-- 本機 SQL 測試用的 Supabase 替身（只給 scripts/sql-tests/run-local.sh 用，不要套用到任何正式環境）
--
-- 只建立 supabase/migrations/*.sql 與 SQL 測試需要的 Supabase 物件，其餘一概不建：
--   - 角色 anon / authenticated / service_role / supabase_auth_admin
--     （屬性比照 Cloud：service_role BYPASSRLS；本機的 postgres 是 superuser，Cloud 不是，
--       但 Cloud 的 postgres 也是 BYPASSRLS 且擁有 public 的表與函式，對測試結果沒有差別）
--   - schema auth、extensions；uuid-ossp 裝在 extensions（Cloud 已預裝）
--   - auth.users：只有 migration 與測試會用到的欄位（Cloud 的表有更多欄位）；
--     擁有者 supabase_auth_admin、啟用 RLS（同 Cloud）
--   - auth.uid() / auth.role() / auth.jwt()：與 Cloud 相同的定義
--     （2026-11-03 以 pg_get_functiondef 唯讀取得），讀 request.jwt.claim(s) 設定
--   - public schema 的 default privileges：Cloud 會把新表、函式、sequence 的權限自動給
--     anon / authenticated / service_role。這裡照做，才測得出 migration 有沒有確實 REVOKE。
-- 不建：auth.copy_email_from_metadata()（只出現在 migration 的註解）、pg_cron、pg_net、vault、
--       supabase_realtime publication、rls_auto_enable()（migration 已處理不存在的情況）。
-- =====================================================================

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;

CREATE SCHEMA auth AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA extensions;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email character varying(255),
  email_confirmed_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  raw_user_meta_data jsonb,
  banned_until timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  is_sso_user boolean NOT NULL DEFAULT false,
  is_anonymous boolean NOT NULL DEFAULT false
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION auth.uid() RETURNS uuid
  LANGUAGE sql STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE FUNCTION auth.role() RETURNS text
  LANGUAGE sql STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;

CREATE FUNCTION auth.jwt() RETURNS jsonb
  LANGUAGE sql STABLE
AS $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
