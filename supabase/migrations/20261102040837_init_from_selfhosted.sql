-- =====================================================================
-- TCurl：自架 Supabase → Supabase Cloud 初始 schema
--
-- 來源：/Users/kaellim/Desktop/projects/urlpj/supabase-2026-11-02/pg_dumpall.sql
--       （2026-11-02 線上 dump，`postgres` 資料庫的 public schema；PG 15.8）
-- 目標：Supabase Cloud project fsneeigsjdryxutmdrmg（PG 17）
-- 依據：docs/superpowers/specs/2026-11-02-workers-migration-design.md 第 7 節
--
-- 以線上 dump 為準（repo 的 migrations/ 已過時，不使用）。
--
-- 對 Cloud 的調整（[CLOUD]）：
--   - 移除所有 `ALTER ... OWNER TO`（Cloud 由套用 migration 的角色擁有）。
--   - 不建立 Cloud 已提供的物件：schema、extensions（pg_cron / pg_net / pgjwt /
--     pg_graphql / supabase_vault 等）、auth.uid()/auth.jwt()/auth.role()、
--     supabase_realtime publication（dump 中沒有任何 public 表加入）、
--     public schema 的 USAGE 與 default privileges（Cloud 預設已相同）、
--     auth.users 的 RLS（Cloud 預設已啟用）。
--   - 不搬 pg_cron 的 2 個 job（每分鐘 REFRESH 兩個 materialized view；
--     程式未讀取這兩個 view，Cloud 也未啟用 pg_cron）。
--   - [SKIP] 不搬 auth.copy_email_from_metadata() 與 on_auth_user_copy_email
--     （Keycloak 補丁，SECURITY DEFINER 可由 metadata 改主要 email，有提權風險）。
--
-- 修正（spec §7，每一處都以 [FIX-n] 標註）：
--   [FIX-1] urls.original_url 加 CHECK (^https?://) NOT VALID
--   [FIX-2] 統計 RPC：非 service_role 呼叫者只能查自己的資料
--   [FIX-3] url_clicks：移除匿名讀寫 policy 與 anon 權限
--   [FIX-4] audit_logs：移除匿名（任何人）寫入
--   [FIX-5] days / limit / page 參數加上下限
--   [HARDEN] 所有函式固定 search_path = ''（物件名一律 schema-qualified）；
--            SECURITY DEFINER 函式收回 PUBLIC / anon 的 EXECUTE
--
-- 注意：本檔只建 schema，不含資料。資料匯入見 scripts/import-data.sh
--       與 docs/superpowers/specs/2026-11-02-data-import.md。
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Extensions（Cloud 已在 `extensions` schema 安裝 uuid-ossp；此行為防呆，已存在則略過）
--    audit_logs.id 的預設值使用 extensions.uuid_generate_v4()
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

CREATE TABLE public.user_profiles (
    id uuid NOT NULL,
    display_name character varying(100),
    email character varying(255),
    avatar_url text,
    metadata jsonb DEFAULT '{}'::jsonb,
    data_source character varying(50) DEFAULT 'manual'::character varying,
    last_synced_at timestamp with time zone,
    preferences jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.user_profiles IS '使用者資料擴展表';
COMMENT ON COLUMN public.user_profiles.metadata IS '組織資訊，包含員工編號、部門、職稱、手機等（JSONB 格式）';
COMMENT ON COLUMN public.user_profiles.data_source IS '資料來源：manual(手動), dawenshi(大文史用戶), google(Google OAuth)';


CREATE TABLE public.urls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    short_code text NOT NULL,
    original_url text NOT NULL,
    qr_code_generated boolean DEFAULT false,
    qr_code_path text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    password_protected boolean DEFAULT false,
    password_hash text,
    qr_code_options jsonb,
    created_by uuid,
    updated_by uuid,
    CONSTRAINT short_code_length CHECK (((length(short_code) >= 4) AND (length(short_code) <= 20)))
);

COMMENT ON TABLE public.urls IS '短網址主表 - 點擊統計已移至 url_clicks 表和相關 Views';
COMMENT ON COLUMN public.urls.short_code IS '短網址代碼（唯一）';
COMMENT ON COLUMN public.urls.qr_code_options IS 'QR Code 客製化設定 (JSON 格式): size, darkColor, lightColor, withLogo, logoCircle, cornerRadius 等';


CREATE TABLE public.url_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url_id uuid NOT NULL,
    group_key character varying(8) NOT NULL,
    name character varying(100) NOT NULL,
    utm_source character varying(100),
    utm_medium character varying(100),
    utm_campaign character varying(200),
    utm_content character varying(200),
    utm_term character varying(200),
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.url_channels IS '短網址管道追蹤 - 每個管道可設定獨立 UTM 參數並產生對應 QR Code';
COMMENT ON COLUMN public.url_channels.group_key IS '管道短碼，用於 URL 參數 g=xxx，6 位英數隨機碼';
COMMENT ON COLUMN public.url_channels.name IS '使用者自定義管道名稱，如「花蓮營隊海報」';


CREATE TABLE public.url_clicks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url_id uuid NOT NULL,
    clicked_at timestamp with time zone DEFAULT now(),
    user_agent text,
    is_qr_scan boolean DEFAULT false,
    event_type character varying(20) DEFAULT 'link_click'::character varying,
    channel_id uuid
);

-- [FIX-3] 原註解寫「已啟用 Realtime」，但 dump 的 supabase_realtime publication 沒有任何表；
--         點擊改由 Worker 以 service role 寫入與讀取。
COMMENT ON TABLE public.url_clicks IS '短網址點擊記錄 - 由後端（service role）寫入與讀取';
COMMENT ON COLUMN public.url_clicks.clicked_at IS '點擊時間戳記 - 用於時間趨勢統計';
COMMENT ON COLUMN public.url_clicks.user_agent IS '用戶代理字串 - 用於裝置類型分析';
COMMENT ON COLUMN public.url_clicks.is_qr_scan IS '是否為 QR Code 掃描 - 用於區分點擊來源';
COMMENT ON COLUMN public.url_clicks.event_type IS 'Event type: link_click, qr_scan, ad_view, ad_click';
COMMENT ON COLUMN public.url_clicks.channel_id IS '來源管道 ID，NULL 表示直接點擊（無管道）';


CREATE TABLE public.audit_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    user_email character varying(255),
    action character varying(50) NOT NULL,
    resource_type character varying(50),
    resource_id uuid,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp with time zone DEFAULT now()
);

COMMENT ON TABLE public.audit_logs IS '審計日誌表，記錄所有重要操作';
COMMENT ON COLUMN public.audit_logs.action IS '操作類型：login, logout, create_url, update_url, delete_url, update_qrcode';


CREATE TABLE public.feedbacks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(200) NOT NULL,
    content text NOT NULL,
    category character varying(50) DEFAULT 'suggestion'::character varying NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    vote_count integer DEFAULT 0,
    comment_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


CREATE TABLE public.feedback_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    feedback_id uuid NOT NULL,
    content text NOT NULL,
    is_official boolean DEFAULT false,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


CREATE TABLE public.feedback_votes (
    feedback_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


-- ---------------------------------------------------------------------
-- 2. Primary keys / unique constraints
-- ---------------------------------------------------------------------
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feedback_comments
    ADD CONSTRAINT feedback_comments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_pkey PRIMARY KEY (feedback_id, user_id);
ALTER TABLE ONLY public.feedbacks
    ADD CONSTRAINT feedbacks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.url_channels
    ADD CONSTRAINT url_channels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.url_channels
    ADD CONSTRAINT url_channels_url_id_group_key_key UNIQUE (url_id, group_key);
ALTER TABLE ONLY public.url_clicks
    ADD CONSTRAINT url_clicks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.urls
    ADD CONSTRAINT urls_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.urls
    ADD CONSTRAINT urls_short_code_key UNIQUE (short_code);
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);


-- ---------------------------------------------------------------------
-- 3. [FIX-1] urls.original_url 只接受 http(s)
--    NOT VALID：不檢查既有資料（自架庫有 1 筆 chrome-extension:// 要保留），
--    但之後所有 INSERT / UPDATE（含 COPY）都會檢查，前端直接寫 Supabase 也擋得住 javascript: 等。
--    注意：COPY 也會檢查 CHECK，所以 scripts/import-data.sh 會在同一個交易內
--    先 DROP 這個 constraint、COPY urls、再以 NOT VALID 加回。
-- ---------------------------------------------------------------------
ALTER TABLE public.urls
    ADD CONSTRAINT urls_original_url_http_check CHECK (original_url ~* '^https?://') NOT VALID;


-- ---------------------------------------------------------------------
-- 4. Materialized views（程式目前未讀取；保留以維持與線上一致）
--    原本由 pg_cron 每分鐘 REFRESH；Cloud 未搬 cron，匯入資料後由 import-data.sh REFRESH 一次。
-- ---------------------------------------------------------------------
CREATE MATERIALIZED VIEW public.url_daily_stats AS
 SELECT url_clicks.url_id,
    date(url_clicks.clicked_at) AS date,
    count(*) AS total_clicks,
    count(*) FILTER (WHERE (url_clicks.is_qr_scan = false)) AS link_clicks,
    count(*) FILTER (WHERE (url_clicks.is_qr_scan = true)) AS qr_scans
   FROM public.url_clicks
  GROUP BY url_clicks.url_id, (date(url_clicks.clicked_at))
  ORDER BY url_clicks.url_id, (date(url_clicks.clicked_at)) DESC
  WITH NO DATA;

CREATE MATERIALIZED VIEW public.url_recent_stats AS
 SELECT u.id AS url_id,
    u.short_code,
    count(c.id) FILTER (WHERE (c.clicked_at >= CURRENT_DATE)) AS today_total,
    count(c.id) FILTER (WHERE ((c.clicked_at >= CURRENT_DATE) AND (c.is_qr_scan = false))) AS today_clicks,
    count(c.id) FILTER (WHERE ((c.clicked_at >= CURRENT_DATE) AND (c.is_qr_scan = true))) AS today_qr_scans,
    count(c.id) FILTER (WHERE (c.clicked_at >= date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone))) AS week_total,
    count(c.id) FILTER (WHERE ((c.clicked_at >= date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone)) AND (c.is_qr_scan = false))) AS week_clicks,
    count(c.id) FILTER (WHERE ((c.clicked_at >= date_trunc('week'::text, (CURRENT_DATE)::timestamp with time zone)) AND (c.is_qr_scan = true))) AS week_qr_scans,
    count(c.id) FILTER (WHERE (c.clicked_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone))) AS month_total,
    count(c.id) FILTER (WHERE ((c.clicked_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (c.is_qr_scan = false))) AS month_clicks,
    count(c.id) FILTER (WHERE ((c.clicked_at >= date_trunc('month'::text, (CURRENT_DATE)::timestamp with time zone)) AND (c.is_qr_scan = true))) AS month_qr_scans,
    count(c.id) AS all_time_total,
    count(c.id) FILTER (WHERE (c.is_qr_scan = false)) AS all_time_clicks,
    count(c.id) FILTER (WHERE (c.is_qr_scan = true)) AS all_time_qr_scans
   FROM (public.urls u
     LEFT JOIN public.url_clicks c ON ((u.id = c.url_id)))
  GROUP BY u.id, u.short_code
  WITH NO DATA;


-- ---------------------------------------------------------------------
-- 5. Indexes
-- ---------------------------------------------------------------------
CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX idx_audit_logs_resource_type ON public.audit_logs USING btree (resource_type);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);
CREATE INDEX idx_clicks_clicked_at ON public.url_clicks USING btree (clicked_at DESC);
CREATE INDEX idx_clicks_url_id ON public.url_clicks USING btree (url_id);
CREATE INDEX idx_feedback_comments_feedback_id ON public.feedback_comments USING btree (feedback_id);
CREATE INDEX idx_feedbacks_category ON public.feedbacks USING btree (category);
CREATE INDEX idx_feedbacks_created_at ON public.feedbacks USING btree (created_at DESC);
CREATE INDEX idx_feedbacks_status ON public.feedbacks USING btree (status);
CREATE INDEX idx_url_channels_group_key ON public.url_channels USING btree (group_key);
CREATE INDEX idx_url_channels_url_id ON public.url_channels USING btree (url_id);
CREATE INDEX idx_url_clicks_channel_id ON public.url_clicks USING btree (channel_id);
CREATE INDEX idx_url_clicks_clicked_at ON public.url_clicks USING btree (clicked_at);
CREATE INDEX idx_url_clicks_event_type ON public.url_clicks USING btree (event_type);
CREATE INDEX idx_url_clicks_stats ON public.url_clicks USING btree (url_id, event_type, clicked_at);
CREATE INDEX idx_url_clicks_url_event ON public.url_clicks USING btree (url_id, event_type);
CREATE INDEX idx_url_clicks_url_id_clicked_at ON public.url_clicks USING btree (url_id, clicked_at);
CREATE INDEX idx_urls_active ON public.urls USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_urls_created_at ON public.urls USING btree (created_at DESC);
CREATE INDEX idx_urls_created_by ON public.urls USING btree (created_by);
CREATE INDEX idx_urls_qr_code_options ON public.urls USING gin (qr_code_options);
CREATE UNIQUE INDEX idx_urls_short_code ON public.urls USING btree (short_code);
CREATE INDEX idx_urls_updated_by ON public.urls USING btree (updated_by);
CREATE INDEX idx_user_profiles_data_source ON public.user_profiles USING btree (data_source);
CREATE INDEX idx_user_profiles_email ON public.user_profiles USING btree (email);
CREATE INDEX url_daily_stats_url_id_date_idx ON public.url_daily_stats USING btree (url_id, date);
CREATE INDEX url_daily_stats_url_id_idx ON public.url_daily_stats USING btree (url_id);
CREATE INDEX url_recent_stats_short_code_idx ON public.url_recent_stats USING btree (short_code);
CREATE UNIQUE INDEX url_recent_stats_url_id_idx ON public.url_recent_stats USING btree (url_id);


-- ---------------------------------------------------------------------
-- 6. Foreign keys
-- ---------------------------------------------------------------------
ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.feedback_comments
    ADD CONSTRAINT feedback_comments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.feedback_comments
    ADD CONSTRAINT feedback_comments_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedbacks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_feedback_id_fkey FOREIGN KEY (feedback_id) REFERENCES public.feedbacks(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feedback_votes
    ADD CONSTRAINT feedback_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feedbacks
    ADD CONSTRAINT feedbacks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.url_channels
    ADD CONSTRAINT url_channels_url_id_fkey FOREIGN KEY (url_id) REFERENCES public.urls(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.url_clicks
    ADD CONSTRAINT url_clicks_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.url_channels(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.url_clicks
    ADD CONSTRAINT url_clicks_url_id_fkey FOREIGN KEY (url_id) REFERENCES public.urls(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.urls
    ADD CONSTRAINT urls_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.urls
    ADD CONSTRAINT urls_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ---------------------------------------------------------------------
-- 7. Functions
--    [HARDEN] 全部加 SET search_path = ''，函式內物件一律 schema-qualified
--    （原本 stats RPC 4 支與 3 支 feedback trigger 函式沒有固定 search_path）。
-- ---------------------------------------------------------------------

-- auth.users AFTER INSERT → 建立 user_profiles（GoTrue 新增使用者時觸發）
CREATE FUNCTION public.create_user_profile() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, display_name, data_source)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    'manual'
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RETURN NEW;
END;
$$;


-- auth.users AFTER UPDATE → 同步 email 到 user_profiles
CREATE FUNCTION public.sync_user_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
  UPDATE public.user_profiles
  SET
    email = NEW.email,
    updated_at = NOW()
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;


CREATE FUNCTION public.get_current_user_profile() RETURNS public.user_profiles
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  profile public.user_profiles;
BEGIN
  SELECT * INTO profile
  FROM public.user_profiles
  WHERE id = auth.uid();

  RETURN profile;
END;
$$;


-- ---- 統計 RPC ---------------------------------------------------------
-- [FIX-2] 原本 4 支統計 RPC 是 SECURITY DEFINER、未檢查呼叫者，且 EXECUTE 仍開給 PUBLIC
--         （等於 anon 也能用任何 user_id / url_id 查別人的統計）。
--         現在：auth.role() = 'service_role'（Worker 後端用 service key 呼叫）才略過檢查；
--         其他呼叫者必須 p_user_id = auth.uid()，或 p_url_id 那筆 url 的 created_by = auth.uid()，
--         否則丟 42501 insufficient_privilege。
-- [FIX-5] days 限制在 1..366、limit 1..100、page 1..100000（避免超大 generate_series / OFFSET）。
--         前端實際使用：days = 7/30/90，limit = 10。

CREATE FUNCTION public.get_daily_stats(p_user_id uuid, p_days integer DEFAULT 30) RETURNS json
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
        AND date(c.clicked_at) = d.date
    ) s ON true
  ) sub;

  RETURN result;
END;
$$;


CREATE FUNCTION public.get_stats_summary(p_user_id uuid) RETURNS json
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
    'totalLinks', (SELECT COUNT(*) FROM public.urls WHERE created_by = p_user_id),
    'activeLinks', (SELECT COUNT(*) FROM public.urls WHERE created_by = p_user_id AND is_active = true),
    'totalClicks', (
      SELECT COUNT(*)
      FROM public.url_clicks c
      INNER JOIN public.urls u ON u.id = c.url_id
      WHERE u.created_by = p_user_id
    )
  ) INTO result;

  RETURN result;
END;
$$;


CREATE FUNCTION public.get_url_stats(p_url_id uuid, p_days integer DEFAULT 30) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  result JSON;
  -- [FIX-5] days 上下限（此參數是「最多回傳幾天的 daily 資料」）
  v_days INT := LEAST(GREATEST(COALESCE(p_days, 30), 1), 366);
BEGIN
  -- [FIX-2] 呼叫者檢查：url 必須屬於 auth.uid()（不存在與不屬於回同一個錯誤，不洩漏存在性）
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM public.urls u
       WHERE u.id = p_url_id AND u.created_by = auth.uid()
     ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT json_build_object(
    'total', (
      SELECT json_build_object(
        'total_clicks', COUNT(*),
        'link_clicks', COUNT(*) FILTER (WHERE event_type = 'link_click' OR event_type = 'ad_click'),
        'qr_scans', COUNT(*) FILTER (WHERE event_type = 'qr_scan'),
        'ad_views', COUNT(*) FILTER (WHERE event_type = 'ad_view'),
        'ad_clicks', COUNT(*) FILTER (WHERE event_type = 'ad_click'),
        'last_clicked_at', MAX(clicked_at)
      )
      FROM public.url_clicks
      WHERE url_id = p_url_id
    ),
    'daily', COALESCE((
      SELECT json_agg(day_row ORDER BY day_row->>'date' DESC)
      FROM (
        SELECT json_build_object(
          'date', date(clicked_at),
          'total_clicks', COUNT(*),
          'link_clicks', COUNT(*) FILTER (WHERE event_type = 'link_click'),
          'qr_scans', COUNT(*) FILTER (WHERE event_type = 'qr_scan'),
          'ad_views', COUNT(*) FILTER (WHERE event_type = 'ad_view'),
          'ad_clicks', COUNT(*) FILTER (WHERE event_type = 'ad_click')
        ) AS day_row
        FROM public.url_clicks
        WHERE url_id = p_url_id
        GROUP BY date(clicked_at)
        ORDER BY date(clicked_at) DESC
        LIMIT v_days
      ) sub
    ), '[]'::json),
    'channels', COALESCE((
      SELECT json_agg(ch_row)
      FROM (
        SELECT json_build_object(
          'channel_id', uc.id,
          'name', uc.name,
          'group_key', uc.group_key,
          'clicks', COUNT(c.id)
        ) AS ch_row
        FROM public.url_channels uc
        LEFT JOIN public.url_clicks c ON c.channel_id = uc.id
        WHERE uc.url_id = p_url_id
        GROUP BY uc.id, uc.name, uc.group_key
      ) sub
    ), '[]'::json),
    'direct_clicks', (
      SELECT COUNT(*)
      FROM public.url_clicks
      WHERE url_id = p_url_id AND channel_id IS NULL
    )
  ) INTO result;

  RETURN result;
END;
$$;


-- 原始碼在 dump 中是單行；此處僅排版成多行，查詢語意不變（除 [FIX-2]/[FIX-5]）。
CREATE FUNCTION public.get_urls_with_stats(p_user_id uuid, p_page integer DEFAULT 1, p_limit integer DEFAULT 10) RETURNS json
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
  FROM public.urls
  WHERE created_by = p_user_id AND is_active = true;

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
          'created_by', u.created_by
        ) AS row_data
        FROM public.urls u
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


-- 注意（既有問題，未修）：audit_logs 沒有 ip_address / user_agent 欄位，
-- 這支函式在線上就會於執行時失敗；程式碼沒有呼叫它。保留以維持一致，
-- 但 [FIX-4] 收回 PUBLIC / anon / authenticated 的 EXECUTE（避免成為匿名寫入 audit_logs 的管道）。
CREATE FUNCTION public.log_audit(p_action character varying, p_resource_type character varying, p_resource_id uuid DEFAULT NULL::uuid, p_old_values jsonb DEFAULT NULL::jsonb, p_new_values jsonb DEFAULT NULL::jsonb, p_ip_address inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  log_id UUID;
  current_user_email VARCHAR(255);
BEGIN
  -- 取得當前用戶 email
  SELECT email INTO current_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- 插入日誌
  INSERT INTO public.audit_logs (
    user_id,
    user_email,
    action,
    resource_type,
    resource_id,
    old_values,
    new_values,
    ip_address,
    user_agent
  ) VALUES (
    auth.uid(),
    current_user_email,
    p_action,
    p_resource_type,
    p_resource_id,
    p_old_values,
    p_new_values,
    p_ip_address,
    p_user_agent
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;


-- urls 的稽核 trigger（SECURITY DEFINER：以函式擁有者身分寫 audit_logs，不受 [FIX-4] 影響）
CREATE FUNCTION public.log_url_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
  current_user_email VARCHAR(255);
  action_type VARCHAR(50);
BEGIN
  SELECT email INTO current_user_email
  FROM auth.users
  WHERE id = auth.uid();

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
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, new_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (user_id, user_email, action, resource_type, resource_id, old_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;


CREATE FUNCTION public.update_feedback_comment_count() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedbacks SET comment_count = comment_count + 1 WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedbacks SET comment_count = comment_count - 1 WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$;


CREATE FUNCTION public.update_feedback_vote_count() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.feedbacks SET vote_count = vote_count + 1 WHERE id = NEW.feedback_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.feedbacks SET vote_count = vote_count - 1 WHERE id = OLD.feedback_id;
  END IF;
  RETURN NULL;
END;
$$;


CREATE FUNCTION public.update_feedbacks_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- 8. Triggers
-- ---------------------------------------------------------------------
CREATE TRIGGER feedback_comment_count_trigger AFTER INSERT OR DELETE ON public.feedback_comments FOR EACH ROW EXECUTE FUNCTION public.update_feedback_comment_count();
CREATE TRIGGER feedback_vote_count_trigger AFTER INSERT OR DELETE ON public.feedback_votes FOR EACH ROW EXECUTE FUNCTION public.update_feedback_vote_count();
CREATE TRIGGER feedbacks_updated_at BEFORE UPDATE ON public.feedbacks FOR EACH ROW EXECUTE FUNCTION public.update_feedbacks_updated_at();
CREATE TRIGGER update_urls_updated_at BEFORE UPDATE ON public.urls FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER url_audit_trigger AFTER INSERT OR DELETE OR UPDATE ON public.urls FOR EACH ROW EXECUTE FUNCTION public.log_url_changes();

-- auth.users 上的 trigger（呼叫 public 函式）。
-- [SKIP] 不建立 on_auth_user_copy_email / auth.copy_email_from_metadata()。
-- 資料匯入時以 session_replication_role = replica 停用這兩個 trigger，避免重複建立 user_profiles。
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_user_profile();
CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.sync_user_email();


-- ---------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.url_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.url_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- urls
CREATE POLICY "Service role can do anything" ON public.urls TO service_role USING (true);
CREATE POLICY "使用者可查看自己的 URL" ON public.urls FOR SELECT USING ((auth.uid() = created_by));
CREATE POLICY "使用者可建立 URL" ON public.urls FOR INSERT WITH CHECK ((auth.uid() = created_by));
CREATE POLICY "使用者可更新自己的 URL" ON public.urls FOR UPDATE USING ((auth.uid() = created_by));
CREATE POLICY "使用者可刪除自己的 URL" ON public.urls FOR DELETE USING ((auth.uid() = created_by));

-- url_channels
CREATE POLICY "Service role full access on channels" ON public.url_channels TO service_role USING (true);
CREATE POLICY "Users can view own URL channels" ON public.url_channels FOR SELECT USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = auth.uid()))));
CREATE POLICY "Users can insert own URL channels" ON public.url_channels FOR INSERT WITH CHECK ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = auth.uid()))));
CREATE POLICY "Users can update own URL channels" ON public.url_channels FOR UPDATE USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = auth.uid()))));
CREATE POLICY "Users can delete own URL channels" ON public.url_channels FOR DELETE USING ((url_id IN ( SELECT urls.id
   FROM public.urls
  WHERE (urls.created_by = auth.uid()))));

-- url_clicks
-- [FIX-3] 不建立 "Anyone can insert clicks"（INSERT WITH CHECK true）與
--         "Anyone can view clicks for realtime"（SELECT USING true）。
--         啟用 RLS 但不給 anon / authenticated 任何 policy → 只有 service role（BYPASSRLS）能讀寫；
--         刪除 urls 時的 ON DELETE CASCADE 由 RI trigger 執行，不受 RLS 影響。

-- audit_logs
-- [FIX-4] 不建立 "系統可插入日誌"（INSERT WITH CHECK true，對 PUBLIC 含 anon）。
--         稽核紀錄只由 log_url_changes()（SECURITY DEFINER，以擁有者身分繞過 RLS）與 service role 寫入。
CREATE POLICY "使用者可查看自己的日誌" ON public.audit_logs FOR SELECT USING ((auth.uid() = user_id));

-- user_profiles
CREATE POLICY "使用者可查看自己的資料" ON public.user_profiles FOR SELECT USING ((auth.uid() = id));
CREATE POLICY "使用者可更新自己的資料" ON public.user_profiles FOR UPDATE USING ((auth.uid() = id));

-- feedbacks
CREATE POLICY feedbacks_select ON public.feedbacks FOR SELECT TO authenticated USING (true);
CREATE POLICY feedbacks_insert ON public.feedbacks FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));
CREATE POLICY feedbacks_update ON public.feedbacks FOR UPDATE TO authenticated USING ((auth.uid() = created_by));
CREATE POLICY feedbacks_delete ON public.feedbacks FOR DELETE TO authenticated USING ((auth.uid() = created_by));

-- feedback_comments
CREATE POLICY feedback_comments_select ON public.feedback_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY feedback_comments_insert ON public.feedback_comments FOR INSERT TO authenticated WITH CHECK ((auth.uid() = created_by));
CREATE POLICY feedback_comments_delete ON public.feedback_comments FOR DELETE TO authenticated USING ((auth.uid() = created_by));

-- feedback_votes
CREATE POLICY feedback_votes_select ON public.feedback_votes FOR SELECT TO authenticated USING (true);
CREATE POLICY feedback_votes_insert ON public.feedback_votes FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));
CREATE POLICY feedback_votes_delete ON public.feedback_votes FOR DELETE TO authenticated USING ((auth.uid() = user_id));


-- ---------------------------------------------------------------------
-- 10. Grants
--     Cloud 的 default privileges 會在建立時自動把 ALL 給 anon / authenticated / service_role，
--     而 PostgreSQL 預設把函式 EXECUTE 給 PUBLIC，所以這裡明確寫出最終權限（含 REVOKE）。
-- ---------------------------------------------------------------------

-- 表：與線上相同
GRANT ALL ON TABLE public.urls TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.user_profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.feedbacks TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.feedback_comments TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.feedback_votes TO anon, authenticated, service_role;

-- url_channels：線上本來就沒有給 anon
REVOKE ALL ON TABLE public.url_channels FROM anon;
GRANT ALL ON TABLE public.url_channels TO authenticated, service_role;

-- [FIX-3] url_clicks：收回 anon 的所有權限（authenticated 保留表權限但沒有任何 policy → 讀寫皆 0 筆）
REVOKE ALL ON TABLE public.url_clicks FROM anon;
GRANT ALL ON TABLE public.url_clicks TO authenticated, service_role;

-- [FIX-4] audit_logs：anon 全收回；authenticated 只留 SELECT（受「只看自己的日誌」policy 限制）
REVOKE ALL ON TABLE public.audit_logs FROM anon;
REVOKE ALL ON TABLE public.audit_logs FROM authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;

-- Materialized views：線上只給 service_role（避免經 Data API 繞過 RLS 讀到別人的統計）
REVOKE ALL ON TABLE public.url_daily_stats FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.url_recent_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.url_daily_stats TO service_role;
GRANT ALL ON TABLE public.url_recent_stats TO service_role;

-- [FIX-2] 統計 RPC：收回 PUBLIC / anon，只給 authenticated（函式內再檢查擁有者）與 service_role
REVOKE ALL ON FUNCTION public.get_daily_stats(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_stats_summary(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_url_stats(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_urls_with_stats(uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_stats(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_stats_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_url_stats(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_urls_with_stats(uuid, integer, integer) TO authenticated, service_role;

-- [HARDEN] get_current_user_profile：SECURITY DEFINER，anon 呼叫只會拿到 NULL，收回 anon
REVOKE ALL ON FUNCTION public.get_current_user_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_profile() TO authenticated, service_role;

-- [FIX-4] log_audit：只留 service_role
REVOKE ALL ON FUNCTION public.log_audit(character varying, character varying, uuid, jsonb, jsonb, inet, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit(character varying, character varying, uuid, jsonb, jsonb, inet, text) TO service_role;

-- [HARDEN] trigger 函式不需要被直接呼叫（PostgreSQL 只在 CREATE TRIGGER 時檢查 EXECUTE，觸發時不檢查），
--          收回 PUBLIC / anon / authenticated，避免 Supabase advisor 的 SECURITY DEFINER 暴露警告。
REVOKE ALL ON FUNCTION public.create_user_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_user_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_url_changes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_feedback_comment_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_feedback_vote_count() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_feedbacks_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user_profile() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_user_email() TO service_role;
GRANT EXECUTE ON FUNCTION public.log_url_changes() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_feedback_comment_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_feedback_vote_count() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_feedbacks_updated_at() TO service_role;


-- ---------------------------------------------------------------------
-- 11. Materialized view 初始內容（空表，瞬間完成；匯入資料後 import-data.sh 會再 REFRESH）
-- ---------------------------------------------------------------------
REFRESH MATERIALIZED VIEW public.url_daily_stats;
REFRESH MATERIALIZED VIEW public.url_recent_stats;
