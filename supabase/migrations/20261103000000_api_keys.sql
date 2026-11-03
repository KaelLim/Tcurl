-- =====================================================================
-- TCurl：服務 API 金鑰
--
-- 依據：docs/superpowers/specs/2026-11-03-api-keys-design.md（§6.2、§6.2.1、§6.2.2、§6.4、§6.6、§6.8）
-- 目標：Supabase Cloud project fsneeigsjdryxutmdrmg（PG 17）
-- 測試：scripts/sql-tests/api_keys_test.sql（本機：bash scripts/sql-tests/run-local.sh）
--
--   [KEYS]   public.api_keys：只存 SHA-256 hex 與顯示用前綴（≤ 15 字元），完整金鑰不進資料庫。
--            啟用 RLS、不建 policy、收回 anon / authenticated：只有 service role（Worker）與
--            下面的 SECURITY DEFINER RPC 能讀寫。撤銷只設 revoked_at，不刪資料列。
--   [URLS]   urls.api_key_id（金鑰建立的短網址；網頁建立的為 null）+ 部分索引。
--   [GUARD]  urls 的 BEFORE INSERT OR UPDATE trigger：JWT role 不是 service_role 的呼叫者（anon /
--            authenticated = 網頁直連 Supabase，以及日後可能出現的其他 role）不能設定或變更 api_key_id
--            （§6.2.2）。service role 與直接連線（沒有 JWT claims：migration、資料匯入、auth.users 刪除時的
--            ON DELETE SET NULL）不受限。新增帶 api_key_id 的列時，created_by 改成金鑰目前的負責同仁
--            （FOR SHARE 讀取，與轉移互斥）；金鑰不存在或沒有負責同仁 → 42501。
--   [AUDIT]  audit_logs.api_key_id；log_url_changes() 在呼叫者是 service_role 時，從 PostgREST 的
--            request.headers 讀 x-tcurl-api-key-id（必須是合法 uuid）記到 audit_logs.api_key_id。
--            一般使用者自己帶這個標頭會被忽略（§6.8）。其餘行為與原版相同。
--   [STATS]  get_urls_with_stats / get_stats_summary / get_daily_stats 加 p_api_key_id uuid DEFAULT NULL：
--            不為 null 時只計算該金鑰的短網址（仍同時限定 created_by = p_user_id）。
--            p_api_key_id 為 null 時行為與原版完全相同（呼叫者檢查、上下限、排序、JSON 形狀），
--            get_urls_with_stats 每筆另外多 api_key_id、api_key_name、api_key_revoked。
--            參數列改變，所以先 DROP 舊簽章再建立（避免 PostgREST 遇到兩個 overload）。
--   [RPC]    verify_api_key / create_api_key / revoke_api_key / update_api_key / list_api_keys。
--            發放、撤銷、修改、轉移各寫一筆 audit_logs（resource_type = 'api_key'，
--            api_key_id = 金鑰 id，old/new_values 不含 key_hash；轉移另記被搬移的短網址 id）。
--            錯誤：負責同仁找不到 → P0002 'owner_not_found'；金鑰不存在 → P0002 'api_key_not_found'；
--                  名稱空白、scopes 不合法、到期日不在未來 → 22023；
--                  p_actor 為 null、key_hash／key_prefix 格式不符（Worker 的錯誤）→ 22023（訊息不含輸入值）。
--
-- 權限：所有 RPC 都是 SECURITY DEFINER + search_path = ''，只給 service_role
--       （比照 20261102044647_restrict_rpc_to_service_role.sql）；金鑰 RPC 內另以 auth.role()
--       拒絕 service_role 以外的 JWT role 作為第二道防線（白名單；沒有 claims 的直接連線放行；
--       不可用 current_user：definer 內是函式擁有者）。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. [KEYS] public.api_keys
-- ---------------------------------------------------------------------
CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    key_prefix text NOT NULL,
    key_hash text NOT NULL,
    owner_id uuid,
    scopes text[] DEFAULT '{read,write}'::text[] NOT NULL,
    expires_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    last_used_at timestamp with time zone,
    CONSTRAINT api_keys_pkey PRIMARY KEY (id),
    CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash),
    CONSTRAINT api_keys_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT api_keys_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
    CONSTRAINT api_keys_scopes_check CHECK (scopes <@ '{read,write}'::text[] AND cardinality(scopes) > 0),
    -- 防呆：完整金鑰（tcurl_sk_ + 43 字元）既放不進 key_hash，也放不進 key_prefix
    CONSTRAINT api_keys_key_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT api_keys_key_prefix_check CHECK (char_length(key_prefix) BETWEEN 1 AND 15)
);

COMMENT ON TABLE public.api_keys IS '服務 API 金鑰：只存 SHA-256 雜湊與顯示用前綴；只有 service role 與金鑰 RPC 能讀寫';
COMMENT ON COLUMN public.api_keys.owner_id IS '負責同仁；帳號被刪除時變成 null，金鑰隨即失效（verify_api_key 回 owner_missing）';
COMMENT ON COLUMN public.api_keys.key_hash IS '完整金鑰的 SHA-256 hex；完整金鑰本身不存';
COMMENT ON COLUMN public.api_keys.key_prefix IS '顯示用的開頭幾碼（金鑰前 15 字元）';
COMMENT ON COLUMN public.api_keys.scopes IS 'read、write 其中之一或兩者';
COMMENT ON COLUMN public.api_keys.last_used_at IS '最後使用時間；verify_api_key 最多每分鐘更新一次';

-- FK 覆蓋索引（advisor unindexed_foreign_keys）；key_hash 由 UNIQUE 約束的索引涵蓋
CREATE INDEX idx_api_keys_owner_id ON public.api_keys USING btree (owner_id);
CREATE INDEX idx_api_keys_created_by ON public.api_keys USING btree (created_by);
CREATE INDEX idx_api_keys_revoked_by ON public.api_keys USING btree (revoked_by);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- 不建 policy。Cloud 的 default privileges 會把新表的 ALL 給 anon / authenticated，這裡收回。
REVOKE ALL ON TABLE public.api_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.api_keys TO service_role;


-- ---------------------------------------------------------------------
-- 2. [URLS] / [AUDIT] 新欄位
-- ---------------------------------------------------------------------
ALTER TABLE public.urls ADD COLUMN api_key_id uuid;
ALTER TABLE ONLY public.urls
    ADD CONSTRAINT urls_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;
CREATE INDEX idx_urls_api_key_id ON public.urls USING btree (api_key_id) WHERE (api_key_id IS NOT NULL);
COMMENT ON COLUMN public.urls.api_key_id IS '以 API 金鑰建立時的金鑰 id；網頁建立的為 null。只有 service role 能設定，不能變更（guard_url_api_key_id）';

ALTER TABLE public.audit_logs ADD COLUMN api_key_id uuid;
COMMENT ON COLUMN public.audit_logs.api_key_id IS '以 API 金鑰操作（或金鑰本身的發放、撤銷、修改、轉移）時的金鑰 id';


-- ---------------------------------------------------------------------
-- 3. [GUARD] 一般使用者不能自己設定 urls.api_key_id（spec §6.2.2）
--    網頁有部分操作直接以使用者身分寫 urls（RLS 只檢查 created_by）；不擋的話，
--    同仁可以把自己的短網址標成某把金鑰的，讓那把金鑰碰得到它。
--    以 auth.role() 判斷（PostgREST 的 JWT role），invoker 權限即可。白名單：JWT role 不是
--    service_role 一律拒絕（spec §6.2.2「不是 service_role 時」；日後 access token hook 發出別的
--    role 也不會被放行）；沒有 claims 的直接連線（auth.role() 為 null）不受限。
--
--    新增帶 api_key_id 的短網址時（service role 或直接連線），created_by 一律改成金鑰「目前」的
--    負責同仁：Worker 寫的是驗證當下的負責同仁，驗證與寫入之間若金鑰被轉移，短網址會留在原負責人
--    名下（金鑰與新負責人都看不到，之後的轉移也搬不走）。FOR SHARE 與 update_api_key 的 FOR UPDATE
--    互斥：轉移進行中就等它 commit 再讀到新的負責同仁；先拿到鎖的話，轉移會等這筆新增 commit，
--    再把它一起搬走。金鑰不存在或沒有負責同仁（帳號已刪除）→ 42501（金鑰此刻沒有可代表的人，
--    與上面兩個拒絕同一類；Worker 回 500，與驗證後才失效的其他情況相同）。訊息不含輸入值。
-- ---------------------------------------------------------------------
CREATE FUNCTION public.guard_url_api_key_id() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    IF TG_OP = 'INSERT' AND NEW.api_key_id IS NOT NULL THEN
      RAISE EXCEPTION 'api_key_id can only be set by the service role' USING ERRCODE = '42501';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.api_key_id IS DISTINCT FROM OLD.api_key_id THEN
      RAISE EXCEPTION 'api_key_id cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.api_key_id IS NOT NULL THEN
    SELECT k.owner_id INTO v_owner_id
    FROM public.api_keys k
    WHERE k.id = NEW.api_key_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'api_key_id does not exist' USING ERRCODE = '42501';
    END IF;
    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'api_key_id has no owner' USING ERRCODE = '42501';
    END IF;
    NEW.created_by := v_owner_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_url_api_key_id BEFORE INSERT OR UPDATE ON public.urls
    FOR EACH ROW EXECUTE FUNCTION public.guard_url_api_key_id();

REVOKE ALL ON FUNCTION public.guard_url_api_key_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_url_api_key_id() TO service_role;


-- ---------------------------------------------------------------------
-- 4. [AUDIT] log_url_changes()：金鑰請求的短網址異動記上 api_key_id（spec §6.8）
--    以 20261102040837_init_from_selfhosted.sql 的版本為底（與線上定義相同，2026-11-03 比對
--    pg_get_functiondef 的 md5），只加 v_api_key_id 的取得與寫入。
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_url_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  current_user_email VARCHAR(255);
  action_type VARCHAR(50);
  v_header TEXT;
  v_api_key_id UUID;
BEGIN
  SELECT email INTO current_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- Worker 處理金鑰請求時以 service role 呼叫，並帶 x-tcurl-api-key-id 標頭。
  -- 只有 service_role 才採信（一般使用者自己帶標頭會被忽略）；不是合法 uuid 也忽略。
  IF auth.role() = 'service_role' THEN
    v_header := nullif(current_setting('request.headers', true), '')::json ->> 'x-tcurl-api-key-id';
    IF v_header ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_api_key_id := v_header::uuid;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    action_type := 'create_url';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.qr_code_options IS DISTINCT FROM NEW.qr_code_options THEN
      action_type := 'update_qrcode';
    ELSE
      action_type := 'update_url';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'delete_url';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, new_values, api_key_id)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(NEW), v_api_key_id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values, api_key_id)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(OLD), to_jsonb(NEW), v_api_key_id);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, api_key_id)
    VALUES (auth.uid(), current_user_email, action_type, 'url', OLD.id, to_jsonb(OLD), v_api_key_id);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


-- ---------------------------------------------------------------------
-- 5. [STATS] 統計 RPC 加 p_api_key_id（spec §6.4）
--    以 init migration 的版本為底（與線上定義相同，已比對 md5）。
--    差異只有：p_api_key_id 參數、每個 urls 條件加
--    `AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)`、
--    get_urls_with_stats 多 LEFT JOIN api_keys 與三個欄位。[FIX-2] / [FIX-5] 不變。
-- ---------------------------------------------------------------------
DROP FUNCTION public.get_daily_stats(uuid, integer);
DROP FUNCTION public.get_stats_summary(uuid);
DROP FUNCTION public.get_urls_with_stats(uuid, integer, integer);

CREATE FUNCTION public.get_daily_stats(p_user_id uuid, p_days integer DEFAULT 30, p_api_key_id uuid DEFAULT NULL) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  result JSON;
  v_start_date TIMESTAMPTZ;
  -- [FIX-5] days 上下限
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 30), 1), 366);
BEGIN
  -- [FIX-2] 呼叫者檢查
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_start_date := NOW() - make_interval(days => v_days);

  -- 產生日期序列並 LEFT JOIN 點擊資料
  SELECT COALESCE(json_agg(day_row ORDER BY day_row->>'date' ASC), '[]'::json)
  INTO result
  FROM (
    SELECT json_build_object(
      'date', d.date::TEXT,
      'link_clicks', COALESCE(s.link_clicks, 0),
      'qr_scans', COALESCE(s.qr_scans, 0),
      'ad_views', COALESCE(s.ad_views, 0),
      'ad_clicks', COALESCE(s.ad_clicks, 0)
    ) AS day_row
    FROM generate_series(v_start_date::DATE, CURRENT_DATE, '1 day'::INTERVAL) AS d(date)
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE c.event_type = 'link_click') AS link_clicks,
        COUNT(*) FILTER (WHERE c.event_type = 'qr_scan') AS qr_scans,
        COUNT(*) FILTER (WHERE c.event_type = 'ad_view') AS ad_views,
        COUNT(*) FILTER (WHERE c.event_type = 'ad_click') AS ad_clicks
      FROM public.url_clicks c
      INNER JOIN public.urls u ON u.id = c.url_id
      WHERE u.created_by = p_user_id
        AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)
        AND date(c.clicked_at) = d.date
    ) s ON true
  ) sub;

  RETURN result;
END;
$$;


CREATE FUNCTION public.get_stats_summary(p_user_id uuid, p_api_key_id uuid DEFAULT NULL) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  result JSON;
BEGIN
  -- [FIX-2] 呼叫者檢查
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'totalLinks', (
      SELECT COUNT(*) FROM public.urls u
      WHERE u.created_by = p_user_id
        AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)
    ),
    'activeLinks', (
      SELECT COUNT(*) FROM public.urls u
      WHERE u.created_by = p_user_id AND u.is_active = true
        AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)
    ),
    'totalClicks', (
      SELECT COUNT(*)
      FROM public.url_clicks c
      INNER JOIN public.urls u ON u.id = c.url_id
      WHERE u.created_by = p_user_id
        AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)
    )
  ) INTO result;

  RETURN result;
END;
$$;


CREATE FUNCTION public.get_urls_with_stats(p_user_id uuid, p_page integer DEFAULT 1, p_limit integer DEFAULT 10, p_api_key_id uuid DEFAULT NULL) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  -- [FIX-5] page / limit 上下限
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);
  v_page INT := LEAST(GREATEST(COALESCE(p_page, 1), 1), 100000);
  v_offset INT;
  v_total INT;
  v_total_pages INT;
  result JSON;
BEGIN
  -- [FIX-2] 呼叫者檢查
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_offset := (v_page - 1) * v_limit;

  SELECT COUNT(*) INTO v_total
  FROM public.urls u
  WHERE u.created_by = p_user_id AND u.is_active = true
    AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id);

  v_total_pages := CEIL(v_total::FLOAT / v_limit);

  SELECT json_build_object(
    'data', COALESCE((
      SELECT json_agg(row_data)
      FROM (
        SELECT json_build_object(
          'id', u.id,
          'short_code', u.short_code,
          'original_url', u.original_url,
          'created_at', u.created_at,
          'is_active', u.is_active,
          'clicks', COALESCE(s.total, 0),
          'link_clicks', COALESCE(s.link_clicks, 0),
          'qr_scans', COALESCE(s.qr_scans, 0),
          'ad_views', COALESCE(s.ad_views, 0),
          'ad_clicks', COALESCE(s.ad_clicks, 0),
          'last_clicked_at', s.last_clicked_at,
          'qr_code_generated', COALESCE(u.qr_code_generated, false),
          'qr_code_path', u.qr_code_path,
          'qr_code_options', u.qr_code_options,
          'password_protected', COALESCE(u.password_protected, false),
          'expires_at', u.expires_at,
          'created_by', u.created_by,
          'api_key_id', u.api_key_id,
          'api_key_name', k.name,
          'api_key_revoked', (k.revoked_at IS NOT NULL)
        ) AS row_data
        FROM public.urls u
        LEFT JOIN public.api_keys k ON k.id = u.api_key_id
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE event_type = 'link_click' OR event_type = 'ad_click') AS link_clicks,
            COUNT(*) FILTER (WHERE event_type = 'qr_scan') AS qr_scans,
            COUNT(*) FILTER (WHERE event_type = 'ad_view') AS ad_views,
            COUNT(*) FILTER (WHERE event_type = 'ad_click') AS ad_clicks,
            MAX(clicked_at) AS last_clicked_at
          FROM public.url_clicks
          WHERE url_id = u.id
        ) s ON true
        WHERE u.created_by = p_user_id AND u.is_active = true
          AND (p_api_key_id IS NULL OR u.api_key_id = p_api_key_id)
        ORDER BY u.created_at DESC
        OFFSET v_offset
        LIMIT v_limit
      ) sub
    ), '[]'::json),
    'pagination', json_build_object(
      'page', v_page,
      'limit', v_limit,
      'total', v_total,
      'totalPages', v_total_pages,
      'hasNext', v_page < v_total_pages,
      'hasPrev', v_page > 1
    )
  ) INTO result;

  RETURN result;
END;
$$;


-- ---------------------------------------------------------------------
-- 6. [RPC] 金鑰 RPC 的內部工具（不經 API 暴露：只有擁有者能執行，
--    由下面的 SECURITY DEFINER 函式以擁有者身分呼叫）
-- ---------------------------------------------------------------------

-- 以 email 找負責同仁：不分大小寫、去除前後空白與換行；必須是未刪除、至少登入過一次、
-- 目前未被停權的 @tzuchi.org.tw 帳號（spec §6.6；網域規則同 hook_restrict_login_domain；
-- 停權條件同 verify_api_key 的 owner_banned，否則發出去或轉過去的金鑰每次都驗證失敗）。
-- 找不到回 null（→ create/update_api_key 拋 P0002 owner_not_found → 400）。
CREATE FUNCTION public.api_key_owner_id(p_email text) RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
  SELECT u.id
  FROM auth.users u
  WHERE lower(u.email) = lower(btrim(p_email, E' \t\r\n'))
    AND u.deleted_at IS NULL
    AND u.last_sign_in_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now())
    AND lower(u.email COLLATE "C") ~ '^[^@[:space:]]+@tzuchi\.org\.tw$'
  ORDER BY u.last_sign_in_at DESC NULLS LAST, u.id
  LIMIT 1;
$$;

-- 金鑰的公開欄位（list_api_keys 的單筆形狀）；不含 key_hash。
CREATE FUNCTION public.api_key_json(p_key_id uuid) RETURNS json
    LANGUAGE sql STABLE
    SET search_path = ''
    AS $$
  SELECT json_build_object(
    'id', k.id,
    'name', k.name,
    'key_prefix', k.key_prefix,
    'scopes', k.scopes,
    'owner_id', k.owner_id,
    'owner_email', o.email,
    'owner_status', CASE
      WHEN o.id IS NULL OR o.deleted_at IS NOT NULL THEN 'deleted'
      WHEN o.banned_until IS NOT NULL AND o.banned_until > now() THEN 'banned'
      ELSE 'active'
    END,
    'owner_last_sign_in_at', o.last_sign_in_at,
    'created_by_email', c.email,
    'created_at', k.created_at,
    'expires_at', k.expires_at,
    'revoked_at', k.revoked_at,
    'last_used_at', k.last_used_at,
    'status', CASE
      WHEN k.revoked_at IS NOT NULL THEN 'revoked'
      WHEN k.expires_at IS NOT NULL AND k.expires_at <= now() THEN 'expired'
      ELSE 'active'
    END,
    'url_count', (SELECT COUNT(*) FROM public.urls u WHERE u.api_key_id = k.id)
  )
  FROM public.api_keys k
  LEFT JOIN auth.users o ON o.id = k.owner_id
  LEFT JOIN auth.users c ON c.id = k.created_by
  WHERE k.id = p_key_id;
$$;

REVOKE ALL ON FUNCTION public.api_key_owner_id(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.api_key_json(uuid) FROM PUBLIC, anon, authenticated, service_role;


-- ---------------------------------------------------------------------
-- 7. [RPC] 金鑰 RPC（Worker 以 service role 呼叫）
-- ---------------------------------------------------------------------

-- 驗證金鑰（spec §6.4）。依序檢查：存在、未撤銷、未過期、負責同仁存在（未刪除）、未被停權。
-- 回傳 {status}；ok 時另有 key_id、name、owner_id、scopes，並把 last_used_at 更新為 now()
-- （原值為 null 或早於 1 分鐘前才寫，避免每個請求都寫一次）。
CREATE FUNCTION public.verify_api_key(p_key_hash text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_key public.api_keys;
  v_owner_deleted_at TIMESTAMPTZ;
  v_owner_banned_until TIMESTAMPTZ;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_key FROM public.api_keys WHERE key_hash = p_key_hash;
  IF NOT FOUND THEN
    RETURN json_build_object('status', 'not_found');
  END IF;
  IF v_key.revoked_at IS NOT NULL THEN
    RETURN json_build_object('status', 'revoked');
  END IF;
  IF v_key.expires_at IS NOT NULL AND v_key.expires_at <= now() THEN
    RETURN json_build_object('status', 'expired');
  END IF;

  SELECT u.deleted_at, u.banned_until INTO v_owner_deleted_at, v_owner_banned_until
  FROM auth.users u
  WHERE u.id = v_key.owner_id;
  IF NOT FOUND OR v_owner_deleted_at IS NOT NULL THEN
    RETURN json_build_object('status', 'owner_missing');
  END IF;
  IF v_owner_banned_until IS NOT NULL AND v_owner_banned_until > now() THEN
    RETURN json_build_object('status', 'owner_banned');
  END IF;

  UPDATE public.api_keys
  SET last_used_at = now()
  WHERE id = v_key.id
    AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');

  RETURN json_build_object(
    'status', 'ok',
    'key_id', v_key.id,
    'name', v_key.name,
    'owner_id', v_key.owner_id,
    'scopes', v_key.scopes
  );
END;
$$;


-- 發放金鑰（spec §6.6）。Worker 產生金鑰後只傳前綴與雜湊。
-- scopes 去重並排序；名稱去除前後空白。
CREATE FUNCTION public.create_api_key(
    p_name text,
    p_owner_email text,
    p_scopes text[],
    p_expires_at timestamp with time zone,
    p_key_prefix text,
    p_key_hash text,
    p_actor uuid
) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_name TEXT := btrim(p_name, E' \t\r\n');
  v_owner_id UUID;
  v_key public.api_keys;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- 管理者歸屬（§6.8）不能無聲遺失；Worker 一定會傳 admin.id
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  IF v_name IS NULL OR v_name = '' THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
  END IF;
  IF p_scopes IS NULL OR cardinality(p_scopes) = 0 OR NOT (p_scopes <@ ARRAY['read', 'write']) THEN
    RAISE EXCEPTION 'invalid_scopes' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_expires_at' USING ERRCODE = '22023';
  END IF;
  -- Worker 的錯誤（例如把完整金鑰當成雜湊或前綴傳入）：在 INSERT 之前就拒絕，訊息不含輸入值。
  -- 否則 CHECK 違反（23514）的 DETAIL 會回顯整列資料。表上的 CHECK 保留當第二道防線。
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_key_hash' USING ERRCODE = '22023';
  END IF;
  IF p_key_prefix IS NULL OR char_length(p_key_prefix) > 15 OR left(p_key_prefix, 9) <> 'tcurl_sk_' THEN
    RAISE EXCEPTION 'invalid_key_prefix' USING ERRCODE = '22023';
  END IF;

  v_owner_id := public.api_key_owner_id(p_owner_email);
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'owner_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.api_keys (name, key_prefix, key_hash, owner_id, scopes, expires_at, created_by)
  VALUES (
    v_name, p_key_prefix, p_key_hash, v_owner_id,
    ARRAY(SELECT DISTINCT s FROM unnest(p_scopes) AS s ORDER BY s),
    p_expires_at, p_actor
  )
  RETURNING * INTO v_key;

  INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, new_values, api_key_id)
  VALUES (
    p_actor, (SELECT email FROM auth.users WHERE id = p_actor), 'issue_api_key', 'api_key', v_key.id,
    to_jsonb(v_key) - 'key_hash', v_key.id
  );

  RETURN public.api_key_json(v_key.id);
END;
$$;


-- 撤銷（立即生效）。已撤銷則不變、不再寫稽核。
CREATE FUNCTION public.revoke_api_key(p_key_id uuid, p_actor uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_key public.api_keys;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- 管理者歸屬（§6.8）不能無聲遺失；Worker 一定會傳 admin.id
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_key FROM public.api_keys WHERE id = p_key_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_key_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_key.revoked_at IS NULL THEN
    UPDATE public.api_keys
    SET revoked_at = now(), revoked_by = p_actor
    WHERE id = p_key_id;

    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values, api_key_id)
    VALUES (
      p_actor, (SELECT email FROM auth.users WHERE id = p_actor), 'revoke_api_key', 'api_key', p_key_id,
      jsonb_build_object('revoked_at', NULL, 'revoked_by', NULL),
      jsonb_build_object('revoked_at', now(), 'revoked_by', p_actor),
      p_key_id
    );
  END IF;

  RETURN public.api_key_json(p_key_id);
END;
$$;


-- 修改名稱、到期日，或轉移負責同仁（spec §6.2.1、§6.6）。參數為 null 表示不改；
-- p_clear_expiry = true 改成不過期（不可與 p_expires_at 同時給）。先檢查全部參數再動資料。
-- 轉移：api_keys.owner_id 與「api_key_id = 這把金鑰，且 created_by = 原負責人或為 null」的
-- 短網址 created_by 在同一個交易內一起改；已撤銷的金鑰也可轉移，仍維持撤銷。
-- 名稱／到期日有變更寫一筆 update_api_key，負責同仁有變更寫一筆 transfer_api_key
-- （new_values 含 urls_moved 筆數與 moved_url_ids 陣列）。
CREATE FUNCTION public.update_api_key(
    p_key_id uuid,
    p_actor uuid,
    p_name text DEFAULT NULL,
    p_expires_at timestamp with time zone DEFAULT NULL,
    p_clear_expiry boolean DEFAULT false,
    p_new_owner_email text DEFAULT NULL
) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  v_key public.api_keys;
  v_name TEXT;
  v_expires_at TIMESTAMPTZ;
  v_new_owner UUID;
  v_actor_email VARCHAR(255);
  v_moved INT;
  v_moved_ids UUID[];
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  -- 管理者歸屬（§6.8）不能無聲遺失；Worker 一定會傳 admin.id
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_key FROM public.api_keys WHERE id = p_key_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'api_key_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_name := v_key.name;
  IF p_name IS NOT NULL THEN
    v_name := btrim(p_name, E' \t\r\n');
    IF v_name = '' THEN
      RAISE EXCEPTION 'invalid_name' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_expires_at := v_key.expires_at;
  IF COALESCE(p_clear_expiry, false) THEN
    IF p_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_expires_at' USING ERRCODE = '22023';
    END IF;
    v_expires_at := NULL;
  ELSIF p_expires_at IS NOT NULL THEN
    IF p_expires_at <= now() THEN
      RAISE EXCEPTION 'invalid_expires_at' USING ERRCODE = '22023';
    END IF;
    v_expires_at := p_expires_at;
  END IF;

  IF p_new_owner_email IS NOT NULL THEN
    v_new_owner := public.api_key_owner_id(p_new_owner_email);
    IF v_new_owner IS NULL THEN
      RAISE EXCEPTION 'owner_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT email INTO v_actor_email FROM auth.users WHERE id = p_actor;

  IF v_name IS DISTINCT FROM v_key.name OR v_expires_at IS DISTINCT FROM v_key.expires_at THEN
    UPDATE public.api_keys
    SET name = v_name, expires_at = v_expires_at
    WHERE id = p_key_id;

    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values, api_key_id)
    VALUES (
      p_actor, v_actor_email, 'update_api_key', 'api_key', p_key_id,
      jsonb_build_object('name', v_key.name, 'expires_at', v_key.expires_at),
      jsonb_build_object('name', v_name, 'expires_at', v_expires_at),
      p_key_id
    );
  END IF;

  IF v_new_owner IS NOT NULL AND v_new_owner IS DISTINCT FROM v_key.owner_id THEN
    UPDATE public.api_keys SET owner_id = v_new_owner WHERE id = p_key_id;

    -- 各筆短網址的 update_url 稽核列沒有歸屬（user_id、api_key_id 都是 null），
    -- 所以把被搬移的 id 記在 transfer_api_key 這一列
    WITH moved AS (
      UPDATE public.urls
      SET created_by = v_new_owner
      WHERE api_key_id = p_key_id
        AND (created_by = v_key.owner_id OR created_by IS NULL)
      RETURNING id
    )
    SELECT count(*), COALESCE(array_agg(id ORDER BY id), '{}') INTO v_moved, v_moved_ids FROM moved;

    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values, api_key_id)
    VALUES (
      p_actor, v_actor_email, 'transfer_api_key', 'api_key', p_key_id,
      jsonb_build_object(
        'owner_id', v_key.owner_id,
        'owner_email', (SELECT email FROM auth.users WHERE id = v_key.owner_id)
      ),
      jsonb_build_object(
        'owner_id', v_new_owner,
        'owner_email', (SELECT email FROM auth.users WHERE id = v_new_owner),
        'urls_moved', v_moved,
        'moved_url_ids', to_jsonb(v_moved_ids)
      ),
      p_key_id
    );
  END IF;

  RETURN public.api_key_json(p_key_id);
END;
$$;


-- 所有金鑰的公開欄位（新的在前）；不含 key_hash。
CREATE FUNCTION public.list_api_keys() RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  result JSON;
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(json_agg(public.api_key_json(k.id) ORDER BY k.created_at DESC, k.id), '[]'::json)
  INTO result
  FROM public.api_keys k;

  RETURN result;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. 權限：新 / 重建的 RPC 只給 service_role
--    （Cloud 的 default privileges 會把新函式的 EXECUTE 給 anon / authenticated，一律收回）
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.get_daily_stats(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_stats_summary(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_urls_with_stats(uuid, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_api_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_api_key(text, text, text[], timestamp with time zone, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_api_key(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_api_key(uuid, uuid, text, timestamp with time zone, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_api_keys() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_daily_stats(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stats_summary(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_urls_with_stats(uuid, integer, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_api_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_api_key(text, text, text[], timestamp with time zone, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_api_key(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_api_key(uuid, uuid, text, timestamp with time zone, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_api_keys() TO service_role;

-- PostgREST 重新載入 schema（統計 RPC 的參數列已改變）
NOTIFY pgrst, 'reload schema';
