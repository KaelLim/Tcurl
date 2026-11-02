-- =====================================================================
-- TCurl：只有 @tzuchi.org.tw 的帳號可以「登入」（不只是註冊）
--
-- Custom Access Token hook：Supabase Auth 每次簽發 access token 前（登入、OAuth 回呼、
-- token_refresh 換發）都以 supabase_auth_admin 身分呼叫。
-- 網域不符 → 回傳 error（403）→ 不簽發 token，使用者拿不到 session；
-- 已登入者在下一次 refresh（最多 jwt_exp = 1 小時）時也會被拒。
-- 既有的非慈濟帳號（匯入時 6 位）資料保留：他們建立的短網址照常轉址，只是無法登入管理。
--
-- 網域規則與 hook_restrict_signup_domain 相同（完全等於 tzuchi.org.tw，不分大小寫，
-- 以 COLLATE "C" 做 lower() 只轉換 ASCII）。
-- 輸入：{"user_id", "claims": {..., "email": ...}, "authentication_method"}
-- 輸出：{"claims": {...}}（原樣放行）或 {"error": {"http_code": 403, "message": ...}}
-- 啟用 URI：pg-functions://postgres/public/hook_restrict_login_domain
-- =====================================================================
CREATE OR REPLACE FUNCTION public.hook_restrict_login_domain(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
DECLARE
  v_email text;
BEGIN
  v_email := lower((event -> 'claims' ->> 'email') COLLATE "C");

  IF v_email IS NOT NULL AND v_email ~ '^[^@[:space:]]+@tzuchi\.org\.tw$' THEN
    RETURN jsonb_build_object('claims', event -> 'claims');
  END IF;

  RETURN jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', '僅限慈濟帳號（@tzuchi.org.tw）登入'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.hook_restrict_login_domain(jsonb) IS
  'Supabase Auth Custom Access Token hook：只對 @tzuchi.org.tw 簽發 access token（pg-functions://postgres/public/hook_restrict_login_domain）。';

REVOKE ALL ON FUNCTION public.hook_restrict_login_domain(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hook_restrict_login_domain(jsonb) TO supabase_auth_admin;
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;

-- 註冊 hook 的訊息改為與登入一致（使用者按的是「Google 登入」）；判斷邏輯不變
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
      'message', '僅限慈濟帳號（@tzuchi.org.tw）登入'
    )
  );
END;
$$;
