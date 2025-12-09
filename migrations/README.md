# Database Migrations

## 執行順序

### Migration 001: 添加使用者認證系統

**檔案**: `001_add_authentication.sql`

**功能**:
- 建立 `user_profiles` 表（使用者資料擴展）
- 建立 `audit_logs` 表（審計日誌）
- 修改 `urls` 表（添加 `created_by` 和 `updated_by`）
- 設定 Row Level Security (RLS)
- 建立自動化 Triggers
- 建立輔助函數

---

## 執行步驟

### 方法 A: 使用 Supabase Dashboard（推薦）

1. **登入 Supabase Dashboard**
   ```
   https://app.supabase.com
   ```

2. **進入 SQL Editor**
   - 左側選單 → SQL Editor
   - 點擊 "New query"

3. **複製並執行 Migration**
   - 複製 `001_add_authentication.sql` 的完整內容
   - 貼上到 SQL Editor
   - 點擊 "Run" 執行

4. **檢查執行結果**
   - 查看底部的訊息區域
   - 應該會看到類似以下的輸出：
     ```
     ========================================
     Migration 001_add_authentication 完成
     ========================================
     user_profiles 記錄數: 0
     urls 總數: X
     urls 有所有者: 0
     urls 無所有者: X
     ```

### 方法 B: 使用命令列（進階）

如果您有安裝 Supabase CLI：

```bash
# 執行 migration
supabase db push

# 或直接執行 SQL 檔案
psql "postgresql://..." < migrations/001_add_authentication.sql
```

---

## 執行後的必要步驟

### 1. 建立系統管理員帳號

在 Supabase Dashboard 中建立系統帳號：

1. **進入 Authentication**
   - 左側選單 → Authentication → Users

2. **Add user**
   - Email: `system@tzuchi.org`
   - Password: （設定一個安全的密碼，例如：32 位隨機字串）
   - Auto Confirm User: ✅（勾選）

3. **複製系統帳號的 UUID**
   - 建立完成後，點擊該用戶
   - 複製 `User UID`（格式：xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx）

### 2. 將現有 URLs 歸屬給系統帳號

回到 SQL Editor，執行以下 SQL（替換 UUID）：

```sql
-- 將系統帳號 UUID 替換到下面
UPDATE urls
SET created_by = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'  -- 替換為實際的系統帳號 UUID
WHERE created_by IS NULL;

-- 驗證結果
SELECT
  COUNT(*) as total_urls,
  COUNT(created_by) as urls_with_owner,
  COUNT(*) - COUNT(created_by) as urls_without_owner
FROM urls;
```

### 3. 驗證 Migration 成功

執行以下 SQL 檢查：

```sql
-- 檢查表是否建立成功
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_profiles', 'audit_logs');

-- 檢查 urls 表是否有新欄位
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'urls'
  AND column_name IN ('created_by', 'updated_by');

-- 檢查 RLS 是否啟用
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('user_profiles', 'urls', 'audit_logs');

-- 檢查 Triggers 是否建立
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public';
```

預期結果：
- ✅ `user_profiles` 和 `audit_logs` 表存在
- ✅ `urls` 表有 `created_by` 和 `updated_by` 欄位
- ✅ 三個表的 `rowsecurity` 都是 `true`
- ✅ 有 3 個 triggers: `on_auth_user_created`, `on_auth_user_updated`, `update_user_profiles_updated_at`

---

## 測試 Migration

### 測試 1: 建立測試用戶

1. 在 Supabase Dashboard → Authentication → Users 建立測試用戶
   - Email: `test@tzuchi.org`
   - Password: `test123456`

2. 檢查 `user_profiles` 是否自動建立：
   ```sql
   SELECT * FROM user_profiles WHERE email = 'test@tzuchi.org';
   ```

### 測試 2: 測試 RLS 政策

```sql
-- 切換到測試用戶的身份（在應用程式中測試）
-- 應該只能看到自己建立的 URLs

-- 系統管理員查詢（使用 service_role key）
SELECT COUNT(*) FROM urls;  -- 可以看到所有

-- 一般用戶查詢（使用 anon key 和 JWT）
-- 只能看到 created_by = 自己的 id 的記錄
```

### 測試 3: 測試審計日誌

```sql
-- 手動插入一筆測試日誌
SELECT log_audit(
  'test_action',
  'test_resource',
  NULL,
  '{"test": "old"}'::jsonb,
  '{"test": "new"}'::jsonb
);

-- 查詢日誌
SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;
```

---

## Rollback（回滾）

如果需要回滾此 migration：

```sql
-- ⚠️ 警告：這會刪除所有認證相關的資料！

-- 1. 停用 RLS
ALTER TABLE user_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE urls DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;

-- 2. 刪除 Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;

-- 3. 刪除函數
DROP FUNCTION IF EXISTS create_user_profile();
DROP FUNCTION IF EXISTS sync_user_email();
DROP FUNCTION IF EXISTS update_updated_at_column();
DROP FUNCTION IF EXISTS get_current_user_profile();
DROP FUNCTION IF EXISTS log_audit(VARCHAR, VARCHAR, UUID, JSONB, JSONB, INET, TEXT);

-- 4. 移除 urls 表的欄位
ALTER TABLE urls DROP COLUMN IF EXISTS created_by;
ALTER TABLE urls DROP COLUMN IF EXISTS updated_by;

-- 5. 刪除表
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS user_profiles;
```

---

## 常見問題

### Q: Migration 執行失敗，顯示 "relation already exists"

**A**: 這表示之前已經執行過部分 migration。解決方法：
1. 檢查哪些表已經存在：
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public';
   ```
2. 如果要重新執行，先執行 Rollback 再執行 Migration

### Q: Trigger 沒有自動建立 user_profile

**A**: 檢查：
1. Trigger 是否存在：
   ```sql
   SELECT * FROM information_schema.triggers
   WHERE trigger_name = 'on_auth_user_created';
   ```
2. 函數是否有錯誤：
   ```sql
   SELECT * FROM user_profiles;  -- 查看是否有錯誤訊息
   ```

### Q: RLS 政策導致無法查詢資料

**A**:
1. 使用 `service_role` key 可以繞過 RLS（後端使用）
2. 使用 `anon` key + JWT token 會受 RLS 限制（前端使用）
3. 檢查當前政策：
   ```sql
   SELECT * FROM pg_policies WHERE tablename IN ('user_profiles', 'urls', 'audit_logs');
   ```

---

## 下一步

Migration 執行完成後，請繼續：

1. ✅ 調整後端 API（添加 JWT 驗證）
2. ✅ 建立登入/註冊頁面
3. ✅ 測試完整流程
