-- ==========================================
-- Migration 002: 添加審計日誌觸發器
-- ==========================================
-- 執行位置：Supabase Dashboard > SQL Editor
-- 作用：自動記錄 urls 表的所有操作
-- ==========================================

-- 1. 建立觸發器函數
CREATE OR REPLACE FUNCTION log_url_changes()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  current_user_email VARCHAR(255);
  action_type VARCHAR(50);
BEGIN
  -- 取得當前用戶 email
  SELECT email INTO current_user_email
  FROM auth.users
  WHERE id = auth.uid();

  -- 判斷操作類型
  IF TG_OP = 'INSERT' THEN
    action_type := 'create_url';
  ELSIF TG_OP = 'UPDATE' THEN
    -- 檢查是否為 QR Code 更新
    IF OLD.qr_code_options IS DISTINCT FROM NEW.qr_code_options THEN
      action_type := 'update_qrcode';
    ELSE
      action_type := 'update_url';
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    action_type := 'delete_url';
  END IF;

  -- 插入審計日誌
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, new_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, old_values, new_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, user_email, action, resource_type, resource_id, old_values)
    VALUES (auth.uid(), current_user_email, action_type, 'url', OLD.id, to_jsonb(OLD));
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 2. 移除舊的觸發器（如果存在）
DROP TRIGGER IF EXISTS url_audit_trigger ON urls;

-- 3. 建立新的觸發器
CREATE TRIGGER url_audit_trigger
AFTER INSERT OR UPDATE OR DELETE ON urls
FOR EACH ROW EXECUTE FUNCTION log_url_changes();

-- 4. 添加註解
COMMENT ON FUNCTION log_url_changes() IS '自動記錄 urls 表操作到 audit_logs';

-- ==========================================
-- 驗證
-- ==========================================
-- 執行以下查詢確認觸發器已建立：
--
-- SELECT trigger_name, event_manipulation, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name = 'url_audit_trigger';
--
-- 預期結果：3 筆記錄 (INSERT, UPDATE, DELETE)
-- ==========================================
