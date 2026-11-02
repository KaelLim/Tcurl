-- =====================================================================
-- TCurl：套用 init migration 後的 Supabase advisor 修正 + 註冊網域限制 hook
--
-- 前一版：20261102040837_init_from_selfhosted.sql（已套用於 Cloud，本檔不修改它）
-- 目標：Supabase Cloud project fsneeigsjdryxutmdrmg（PG 17）
--
--   [ADVISOR-1] auth_rls_initplan（18 個 policy）：auth.uid() 改成 (select auth.uid())，
--               讓 Postgres 以 InitPlan 每個查詢只算一次，不再逐列重算。
--               policy 名稱、指令、角色、PERMISSIVE 與語意完全不變。
--   [ADVISOR-2] duplicate_index：public.urls 的 idx_urls_short_code 與 urls_short_code_key
--               完全相同；保留 UNIQUE 約束背後的 urls_short_code_key，刪除前者。
--   [ADVISOR-3] unindexed_foreign_keys：補 feedback_comments(created_by)、
--               feedback_votes(user_id)、feedbacks(created_by) 的索引。
--   [ADVISOR-4] public.rls_auto_enable()（Supabase 提供的 event trigger 函式，SECURITY DEFINER）
--               收回 PUBLIC / anon / authenticated 的 EXECUTE。
--   [HOOK]      public.hook_restrict_signup_domain(jsonb)：Supabase Auth「Before User Created」hook，
--               只允許 @tzuchi.org.tw 註冊。本檔只建立函式與權限，不啟用 hook；
--               啟用時 URI 用 pg-functions://postgres/public/hook_restrict_signup_domain
--
-- 可重複套用：DROP ... IF EXISTS / CREATE INDEX IF NOT EXISTS / CREATE OR REPLACE。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. [ADVISOR-1] RLS policy：auth.uid() → (select auth.uid())
--    逐一 DROP 再以相同名稱、指令、角色重建。沒有寫 TO 的 policy 維持 TO public（與原本相同）。
--    service_role 的兩個 policy（USING (true)）沒有呼叫 auth.*，不需要改。
-- ---------------------------------------------------------------------

-- urls
DROP POLICY IF EXISTS "使用者可查看自己的 URL" ON public.urls;
CREATE POLICY "使用者可查看自己的 URL" ON public.urls FOR SELECT USING (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS "使用者可建立 URL" ON public.urls;
CREATE POLICY "使用者可建立 URL" ON public.urls FOR INSERT WITH CHECK (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS "使用者可更新自己的 URL" ON public.urls;
CREATE POLICY "使用者可更新自己的 URL" ON public.urls FOR UPDATE USING (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS "使用者可刪除自己的 URL" ON public.urls;
CREATE POLICY "使用者可刪除自己的 URL" ON public.urls FOR DELETE USING (((select auth.uid()) = created_by));

-- url_channels
DROP POLICY IF EXISTS "Users can view own URL channels" ON public.url_channels;
CREATE POLICY "Users can view own URL channels" ON public.url_channels FOR SELECT USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = (select auth.uid())))));
DROP POLICY IF EXISTS "Users can insert own URL channels" ON public.url_channels;
CREATE POLICY "Users can insert own URL channels" ON public.url_channels FOR INSERT WITH CHECK ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = (select auth.uid())))));
DROP POLICY IF EXISTS "Users can update own URL channels" ON public.url_channels;
CREATE POLICY "Users can update own URL channels" ON public.url_channels FOR UPDATE USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = (select auth.uid())))));
DROP POLICY IF EXISTS "Users can delete own URL channels" ON public.url_channels;
CREATE POLICY "Users can delete own URL channels" ON public.url_channels FOR DELETE USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = (select auth.uid())))));

-- audit_logs
DROP POLICY IF EXISTS "使用者可查看自己的日誌" ON public.audit_logs;
CREATE POLICY "使用者可查看自己的日誌" ON public.audit_logs FOR SELECT USING (((select auth.uid()) = user_id));

-- user_profiles
DROP POLICY IF EXISTS "使用者可查看自己的資料" ON public.user_profiles;
CREATE POLICY "使用者可查看自己的資料" ON public.user_profiles FOR SELECT USING (((select auth.uid()) = id));
DROP POLICY IF EXISTS "使用者可更新自己的資料" ON public.user_profiles;
CREATE POLICY "使用者可更新自己的資料" ON public.user_profiles FOR UPDATE USING (((select auth.uid()) = id));

-- feedbacks
DROP POLICY IF EXISTS feedbacks_insert ON public.feedbacks;
CREATE POLICY feedbacks_insert ON public.feedbacks FOR INSERT TO authenticated WITH CHECK (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS feedbacks_update ON public.feedbacks;
CREATE POLICY feedbacks_update ON public.feedbacks FOR UPDATE TO authenticated USING (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS feedbacks_delete ON public.feedbacks;
CREATE POLICY feedbacks_delete ON public.feedbacks FOR DELETE TO authenticated USING (((select auth.uid()) = created_by));

-- feedback_comments
DROP POLICY IF EXISTS feedback_comments_insert ON public.feedback_comments;
CREATE POLICY feedback_comments_insert ON public.feedback_comments FOR INSERT TO authenticated WITH CHECK (((select auth.uid()) = created_by));
DROP POLICY IF EXISTS feedback_comments_delete ON public.feedback_comments;
CREATE POLICY feedback_comments_delete ON public.feedback_comments FOR DELETE TO authenticated USING (((select auth.uid()) = created_by));

-- feedback_votes
DROP POLICY IF EXISTS feedback_votes_insert ON public.feedback_votes;
CREATE POLICY feedback_votes_insert ON public.feedback_votes FOR INSERT TO authenticated WITH CHECK (((select auth.uid()) = user_id));
DROP POLICY IF EXISTS feedback_votes_delete ON public.feedback_votes;
CREATE POLICY feedback_votes_delete ON public.feedback_votes FOR DELETE TO authenticated USING (((select auth.uid()) = user_id));


-- ---------------------------------------------------------------------
-- 2. [ADVISOR-2] 重複索引：urls_short_code_key（UNIQUE 約束）已涵蓋 short_code 的唯一性與查詢，
--    idx_urls_short_code 是多餘的（沒有 FK 參照 short_code）。
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_urls_short_code;


-- ---------------------------------------------------------------------
-- 3. [ADVISOR-3] FK 覆蓋索引（三張表目前都只有個位數筆數，建立瞬間完成）
--    feedback_votes 的 PK 是 (feedback_id, user_id)，user_id 不是前導欄位，不能涵蓋 user_id 的 FK。
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_feedback_comments_created_by ON public.feedback_comments USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_feedback_votes_user_id ON public.feedback_votes USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_feedbacks_created_by ON public.feedbacks USING btree (created_by);


-- ---------------------------------------------------------------------
-- 4. [ADVISOR-4] public.rls_auto_enable()
--    Supabase 提供（不是本專案建立）：event trigger ensure_rls（ddl_command_end，CREATE TABLE /
--    CREATE TABLE AS / SELECT INTO）呼叫它，自動對 public 新表啟用 RLS；擁有者 postgres，SECURITY DEFINER。
--    PostgreSQL 觸發 event trigger 時不檢查呼叫者對函式的 EXECUTE（已在 PGlite PG 17 / 18 驗證：
--    收回 PUBLIC / anon / authenticated，甚至連擁有者都收回後，非擁有者執行 DDL 仍會觸發並啟用 RLS），
--    所以收回只會擋掉 /rest/v1/rpc/rls_auto_enable，不影響自動啟用 RLS。
--    擁有者 postgres 與 service_role 保留 EXECUTE（維持 Supabase 預設）。
--    函式不存在時（例如本機環境）略過。
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$$;


-- ---------------------------------------------------------------------
-- 5. [HOOK] Before User Created hook：只允許 @tzuchi.org.tw 註冊
--
--    Supabase Auth 在「建立新使用者之前」以 supabase_auth_admin 身分呼叫，
--    payload 為 {"metadata": {...}, "user": {"email": ..., ...}}。
--    回傳 {} → 允許；回傳 {"error": {"http_code": 403, "message": ...}} → 拒絕，使用者不會被建立。
--
--    規則：email 的網域必須「完全等於」tzuchi.org.tw（不分大小寫）：
--      - 允許：user@tzuchi.org.tw、USER@TZUCHI.ORG.TW
--      - 拒絕：email 為 null / 缺少 / 空字串、gmail.com、evil-tzuchi.org.tw、
--              tzuchi.org.tw.evil.com、sub.tzuchi.org.tw、多個 @、含空白
--    以 COLLATE "C" 做 lower()：只轉換 ASCII A–Z，避免非 ASCII 字元（例如 U+0130 İ）
--    在 ICU / libc locale 下被轉成 ASCII 字母而混過比對。
--
--    既有使用者不受影響：hook 只在「建立使用者」時執行；既有帳號登入、
--    以 Google 登入後自動連結到同 email 的既有帳號，都不會建立新使用者，不會呼叫 hook。
--
--    不使用 SECURITY DEFINER（Supabase 文件建議）；函式不讀任何表，只需要 EXECUTE。
--    啟用：Dashboard → Authentication → Hooks → Before User Created → Postgres function
--          URI：pg-functions://postgres/public/hook_restrict_signup_domain
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hook_restrict_signup_domain(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower((event -> 'user' ->> 'email') COLLATE "C");

  IF v_email IS NOT NULL AND v_email ~ '^[^@[:space:]]+@tzuchi\.org\.tw$' THEN
    RETURN '{}'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '僅限慈濟帳號（@tzuchi.org.tw）註冊'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hook_restrict_signup_domain(jsonb) IS
  'Supabase Auth Before User Created hook：只允許 @tzuchi.org.tw 註冊（pg-functions://postgres/public/hook_restrict_signup_domain）。只在建立新使用者時執行，既有使用者不受影響。';

-- 權限（依 Supabase Auth Hooks 文件）：只給 supabase_auth_admin，不經 Data API 暴露
REVOKE ALL ON FUNCTION public.hook_restrict_signup_domain(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_restrict_signup_domain(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
