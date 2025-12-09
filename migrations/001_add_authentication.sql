-- ==========================================
-- Migration: 001_add_authentication
-- Description: 添加使用者認證系統
-- Created: 2024-01-20
-- ==========================================

-- ==========================================
-- 1. 建立 user_profiles 表
-- ==========================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 基本資料
  display_name VARCHAR(100),
  email VARCHAR(255),
  avatar_url TEXT,

  -- 組織資訊（JSONB 靈活儲存）
  metadata JSONB DEFAULT '{}'::jsonb,
  -- 範例結構：
  -- {
  --   "employee_id": "EMP001",
  --   "department": "資訊室",
  --   "job_title": "工程師",
  --   "mobile": "0912345678",
  --   "office_phone": "03-1234567",
  --   "extension": "123"
  -- }

  -- 資料來源追蹤（未來用於大文史用戶整合）
  data_source VARCHAR(50) DEFAULT 'manual',
  last_synced_at TIMESTAMP WITH TIME ZONE,

  -- 使用者偏好設定
  preferences JSONB DEFAULT '{}'::jsonb,

  -- 時間戳記
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_data_source ON user_profiles(data_source);

-- 添加註解
COMMENT ON TABLE user_profiles IS '使用者資料擴展表';
COMMENT ON COLUMN user_profiles.metadata IS '組織資訊，包含員工編號、部門、職稱、手機等（JSONB 格式）';
COMMENT ON COLUMN user_profiles.data_source IS '資料來源：manual(手動), dawenshi(大文史用戶), google(Google OAuth)';

-- ==========================================
-- 2. 建立 audit_logs 表
-- ==========================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- 操作者資訊
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email VARCHAR(255),

  -- 操作資訊
  action VARCHAR(50) NOT NULL,
  -- 可能的值：
  -- 'login', 'logout'
  -- 'create_url', 'update_url', 'delete_url'
  -- 'update_qrcode'

  resource_type VARCHAR(50),
  -- 可能的值：'auth', 'url', 'qrcode', 'profile'

  resource_id UUID,

  -- 變更詳情
  old_values JSONB,
  new_values JSONB,

  -- 時間戳記
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- 添加註解
COMMENT ON TABLE audit_logs IS '審計日誌表，記錄所有重要操作';
COMMENT ON COLUMN audit_logs.action IS '操作類型：login, logout, create_url, update_url, delete_url, update_qrcode';

-- ==========================================
-- 3. 修改 urls 表（添加所有者欄位）
-- ==========================================

-- 檢查欄位是否已存在，避免重複執行錯誤
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'urls' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE urls ADD COLUMN created_by UUID REFERENCES auth.users(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'urls' AND column_name = 'updated_by'
  ) THEN
    ALTER TABLE urls ADD COLUMN updated_by UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_urls_created_by ON urls(created_by);
CREATE INDEX IF NOT EXISTS idx_urls_updated_by ON urls(updated_by);
CREATE INDEX IF NOT EXISTS idx_urls_created_at ON urls(created_at DESC);

-- ==========================================
-- 4. 建立系統帳號並處理現有資料
-- ==========================================

-- 建立系統管理員帳號（如果不存在）
-- 注意：這個帳號需要在 Supabase Auth 中手動建立
-- Email: system@tzuchi.org
-- Password: （請設定一個安全的密碼）

-- 為現有的 URLs 設定所有者為系統帳號
-- 執行前請先在 Supabase Auth 建立 system@tzuchi.org 帳號
-- 然後將下面的 UUID 替換為實際的系統帳號 UUID

-- UPDATE urls
-- SET created_by = '系統帳號的UUID'
-- WHERE created_by IS NULL;

-- 上面的 UPDATE 語句已註解，需要手動執行
-- 步驟：
-- 1. 在 Supabase Dashboard 建立 system@tzuchi.org 帳號
-- 2. 複製該帳號的 UUID
-- 3. 執行上面的 UPDATE 語句（替換 UUID）

-- ==========================================
-- 5. 建立自動化 Triggers
-- ==========================================

-- 5.1 新用戶註冊時自動建立 user_profile
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
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
    -- 如果已存在則忽略
    RETURN NEW;
END;
$$;

-- 建立 Trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION create_user_profile();

-- 5.2 auth.users email 更新時同步到 user_profiles
CREATE OR REPLACE FUNCTION sync_user_email()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
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

-- 建立 Trigger
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION sync_user_email();

-- 5.3 user_profiles 更新時自動更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 建立 Trigger
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ==========================================
-- 6. 啟用 Row Level Security (RLS)
-- ==========================================

-- 6.1 user_profiles RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 刪除舊政策（如果存在）
DROP POLICY IF EXISTS "使用者可查看自己的資料" ON user_profiles;
DROP POLICY IF EXISTS "使用者可更新自己的資料" ON user_profiles;

-- 使用者可查看自己的資料
CREATE POLICY "使用者可查看自己的資料"
  ON user_profiles
  FOR SELECT
  USING (auth.uid() = id);

-- 使用者可更新自己的資料
CREATE POLICY "使用者可更新自己的資料"
  ON user_profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- 6.2 urls RLS
ALTER TABLE urls ENABLE ROW LEVEL SECURITY;

-- 刪除舊政策（如果存在）
DROP POLICY IF EXISTS "使用者可查看自己的 URL" ON urls;
DROP POLICY IF EXISTS "使用者可建立 URL" ON urls;
DROP POLICY IF EXISTS "使用者可更新自己的 URL" ON urls;
DROP POLICY IF EXISTS "使用者可刪除自己的 URL" ON urls;
DROP POLICY IF EXISTS "允許匿名訪問短網址" ON urls;

-- 使用者可查看自己建立的 URL
CREATE POLICY "使用者可查看自己的 URL"
  ON urls
  FOR SELECT
  USING (auth.uid() = created_by);

-- 使用者可建立 URL
CREATE POLICY "使用者可建立 URL"
  ON urls
  FOR INSERT
  WITH CHECK (auth.uid() = created_by);

-- 使用者可更新自己的 URL
CREATE POLICY "使用者可更新自己的 URL"
  ON urls
  FOR UPDATE
  USING (auth.uid() = created_by);

-- 使用者可刪除自己的 URL
CREATE POLICY "使用者可刪除自己的 URL"
  ON urls
  FOR DELETE
  USING (auth.uid() = created_by);

-- 允許匿名訪問短網址（用於重定向）
-- 注意：這個政策允許未登入的用戶透過 short_code 訪問 URL
-- 這是必要的，因為短網址重定向不需要登入
CREATE POLICY "允許匿名訪問短網址"
  ON urls
  FOR SELECT
  USING (true);

-- 6.3 audit_logs RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 刪除舊政策（如果存在）
DROP POLICY IF EXISTS "使用者可查看自己的日誌" ON audit_logs;
DROP POLICY IF EXISTS "系統可插入日誌" ON audit_logs;

-- 使用者只能查看自己的日誌
CREATE POLICY "使用者可查看自己的日誌"
  ON audit_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- 允許系統插入日誌（透過 service_role）
CREATE POLICY "系統可插入日誌"
  ON audit_logs
  FOR INSERT
  WITH CHECK (true);

-- ==========================================
-- 7. 建立輔助函數
-- ==========================================

-- 7.1 取得當前使用者的 profile
CREATE OR REPLACE FUNCTION get_current_user_profile()
RETURNS user_profiles
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  profile user_profiles;
BEGIN
  SELECT * INTO profile
  FROM user_profiles
  WHERE id = auth.uid();

  RETURN profile;
END;
$$;

-- 7.2 記錄審計日誌的輔助函數
CREATE OR REPLACE FUNCTION log_audit(
  p_action VARCHAR(50),
  p_resource_type VARCHAR(50),
  p_resource_id UUID DEFAULT NULL,
  p_old_values JSONB DEFAULT NULL,
  p_new_values JSONB DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
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
  INSERT INTO audit_logs (
    user_id,
    user_email,
    action,
    resource_type,
    resource_id,
    old_values,
    new_values
  ) VALUES (
    auth.uid(),
    current_user_email,
    p_action,
    p_resource_type,
    p_resource_id,
    p_old_values,
    p_new_values
  )
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$;

-- ==========================================
-- Migration 完成
-- ==========================================

-- 顯示統計資訊
DO $$
DECLARE
  profile_count INTEGER;
  url_count INTEGER;
  url_with_owner_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO profile_count FROM user_profiles;
  SELECT COUNT(*) INTO url_count FROM urls;
  SELECT COUNT(*) INTO url_with_owner_count FROM urls WHERE created_by IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 001_add_authentication 完成';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'user_profiles 記錄數: %', profile_count;
  RAISE NOTICE 'urls 總數: %', url_count;
  RAISE NOTICE 'urls 有所有者: %', url_with_owner_count;
  RAISE NOTICE 'urls 無所有者: %', (url_count - url_with_owner_count);
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  重要提醒：';
  RAISE NOTICE '1. 請在 Supabase Dashboard 建立系統帳號 system@tzuchi.org';
  RAISE NOTICE '2. 執行以下 SQL 將現有 URLs 歸屬給系統帳號：';
  RAISE NOTICE '   UPDATE urls SET created_by = ''系統帳號UUID'' WHERE created_by IS NULL;';
  RAISE NOTICE '========================================';
END $$;
