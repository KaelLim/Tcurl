# 備份與還原指南

## 📦 備份內容

此備份於 **2025-12-01** 建立，包含以下檔案：

### 1. 資料庫備份檔案

| 檔案名稱 | 大小 | 說明 |
|---------|------|------|
| `backup_full.sql` | 61KB | 完整備份（Schema + Data） |
| `backup_schema_only.sql` | 34KB | 僅資料表結構 |
| `backup_data_only.sql` | 27KB | 僅資料內容 |

### 2. 設定檔備份

| 檔案名稱 | 說明 |
|---------|------|
| `backup_env` | 環境變數設定檔 |

---

## 🔄 還原到新 Supabase 的步驟

### 方法 A: 完整還原（推薦）

適用於全新的 Supabase 實例，包含資料表結構和資料。

#### 步驟 1: 準備新 Supabase 實例

1. 登入 Supabase Dashboard
   ```
   https://app.supabase.com
   ```

2. 建立新專案或選擇現有專案

3. 取得以下資訊（儲存備用）：
   - `Project URL` (例如: `https://xxx.supabase.co`)
   - `API Keys` → `anon` (public)
   - `API Keys` → `service_role` (secret)
   - `Database Password`

#### 步驟 2: 還原資料庫

**選項 2A: 使用 Supabase Dashboard（簡單）**

1. 進入 SQL Editor
   - 左側選單 → SQL Editor
   - 點擊 "New query"

2. 複製並執行完整備份
   ```bash
   # 在本地開啟 backup_full.sql
   cat backup_full.sql
   ```

3. 將內容貼上到 SQL Editor
4. 點擊 "Run" 執行

**選項 2B: 使用 psql 命令列（進階）**

```bash
# 1. 安裝 PostgreSQL 客戶端工具（如果尚未安裝）
# Ubuntu/Debian:
sudo apt-get install postgresql-client

# macOS:
brew install postgresql

# 2. 設定資料庫連線資訊
DB_HOST="db.xxx.supabase.co"
DB_NAME="postgres"
DB_USER="postgres"
DB_PASSWORD="你的資料庫密碼"

# 3. 還原完整備份
psql "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME" \
  < backup_full.sql
```

**選項 2C: 使用 Supabase CLI（推薦給進階用戶）**

```bash
# 1. 安裝 Supabase CLI（如果尚未安裝）
npm install -g supabase

# 2. 登入
supabase login

# 3. 連結到新專案
supabase link --project-ref xxx  # 替換為你的 Project Reference ID

# 4. 還原資料庫
supabase db push --db-url "postgresql://postgres:密碼@db.xxx.supabase.co:5432/postgres" \
  --file backup_full.sql
```

#### 步驟 3: 驗證還原成功

在 SQL Editor 執行以下查詢檢查：

```sql
-- 1. 檢查資料表是否建立成功
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- 預期結果：應包含 audit_logs, url_clicks, urls, user_profiles

-- 2. 檢查資料是否還原
SELECT
  (SELECT COUNT(*) FROM urls) as urls_count,
  (SELECT COUNT(*) FROM url_clicks) as clicks_count,
  (SELECT COUNT(*) FROM user_profiles) as profiles_count,
  (SELECT COUNT(*) FROM audit_logs) as logs_count;

-- 3. 檢查 RLS 是否啟用
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- 預期結果：所有表的 rowsecurity 應為 true

-- 4. 檢查 Triggers 是否建立
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 預期結果：應有以下 triggers:
-- - on_auth_user_created
-- - on_auth_user_updated
-- - update_user_profiles_updated_at
-- - update_urls_updated_at

-- 5. 檢查函數是否建立
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- 預期結果：應包含
-- - create_user_profile
-- - get_current_user_profile
-- - log_audit
-- - sync_user_email
-- - update_updated_at_column
```

#### 步驟 4: 更新應用程式環境變數

編輯 `/web/html/urlpj/shorturl-api/.env`：

```env
# Server Configuration
PORT=8080
HOST=0.0.0.0
NODE_ENV=production  # 改為 production

# Supabase Configuration
SUPABASE_URL=https://xxx.supabase.co  # 替換為新 Supabase URL
SUPABASE_ANON_KEY=eyJxxx...  # 替換為新 anon key
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...  # 替換為新 service_role key

# Short URL Configuration
BASE_URL=https://urlpj.tzuchi-org.tw
SHORT_CODE_LENGTH=6

# QR Code Configuration
QR_CODE_SIZE=300
QR_CODE_QUALITY=M
```

#### 步驟 5: 重啟應用程式

```bash
cd /web/html/urlpj/shorturl-api

# 停止舊服務
pm2 stop shorturl-api  # 或使用你的進程管理器

# 清除 Redis 快取（如果有使用）
redis-cli FLUSHDB

# 重新啟動
npm run build
npm start
# 或
pm2 restart shorturl-api
```

#### 步驟 6: 測試功能

1. **測試短網址重定向**
   ```bash
   curl -I https://urlpj.tzuchi-org.tw/s/{短代碼}
   ```

2. **測試 API**
   ```bash
   curl https://urlpj.tzuchi-org.tw/api/urls
   ```

3. **測試前端頁面**
   - 訪問首頁：`https://urlpj.tzuchi-org.tw/`
   - 訪問連結管理：`https://urlpj.tzuchi-org.tw/links.html`
   - 測試建立短網址功能

---

### 方法 B: 僅還原資料表結構

適用於只需要資料表結構，不需要舊資料的情況。

```bash
# 使用 backup_schema_only.sql
psql "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME" \
  < backup_schema_only.sql
```

---

### 方法 C: 分離還原（Schema 先，Data 後）

適用於需要在還原資料前進行調整的情況。

```bash
# 1. 先還原資料表結構
psql "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME" \
  < backup_schema_only.sql

# 2. 手動調整或驗證資料表結構
# ... 進行必要的調整 ...

# 3. 再還原資料
psql "postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:5432/$DB_NAME" \
  < backup_data_only.sql
```

---

## 🔧 故障排除

### 問題 1: 還原時出現 "already exists" 錯誤

**原因**：目標資料庫已有同名資料表。

**解決方案**：
```sql
-- 選項 A: 使用 backup_full.sql（已包含 DROP 語句）
-- 它會自動清除舊表再重建

-- 選項 B: 手動清除現有資料表
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS url_clicks CASCADE;
DROP TABLE IF EXISTS urls CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- 然後重新執行還原
```

### 問題 2: RLS 政策導致無法查詢資料

**原因**：使用 `anon` key 查詢受 RLS 保護的資料。

**解決方案**：
```javascript
// 後端 API 應使用 service_role key
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // 使用 service_role
)
```

### 問題 3: 短網址重定向失敗

**檢查清單**：
1. 確認 URLs 資料已還原
   ```sql
   SELECT COUNT(*) FROM urls;
   ```

2. 確認 RLS 政策允許匿名訪問
   ```sql
   SELECT * FROM pg_policies
   WHERE tablename = 'urls'
     AND policyname = '允許匿名訪問短網址';
   ```

3. 確認應用程式 Supabase 連線設定正確
   ```bash
   # 檢查 .env 檔案
   cat /web/html/urlpj/shorturl-api/.env
   ```

### 問題 4: QR Code 圖片遺失

**原因**：QR Code PNG 檔案未包含在資料庫備份中。

**解決方案**：
```bash
# 1. 備份舊 QR Code 檔案
cp -r /web/html/urlpj/shorturl-api/public/qrcodes /web/html/urlpj/shorturl-api/backups/qrcodes_backup

# 2. 在新環境還原
cp -r backups/qrcodes_backup/* /web/html/urlpj/shorturl-api/public/qrcodes/

# 或：重新生成所有 QR Code
# 透過編輯頁面逐一重新客製化並儲存
```

---

## 📋 備份資訊摘要

### 原始環境資訊

- **Supabase URL**: `http://localhost:8000` (Docker 本地部署)
- **資料庫版本**: PostgreSQL 15.8
- **備份時間**: 2025-12-01 14:55-14:59 UTC
- **備份方式**: `pg_dump` with `--clean --if-exists`

### 資料表清單

1. **urls** - 短網址主表
   - 欄位: `id`, `short_code`, `original_url`, `password_protected`, `password_hash`, `expires_at`, `qr_code_options`, `qr_code_path`, `qr_code_generated`, `is_active`, `created_by`, `updated_by`, `created_at`, `updated_at`
   - RLS: ✅ 啟用
   - 政策: 使用者可查看/建立/更新/刪除自己的 URL；允許匿名訪問短網址

2. **url_clicks** - 點擊記錄表
   - 欄位: `id`, `url_id`, `click_type`, `clicked_at`
   - RLS: ✅ 啟用
   - 政策: 允許匿名插入點擊記錄

3. **user_profiles** - 使用者資料擴展表
   - 欄位: `id`, `display_name`, `email`, `avatar_url`, `metadata`, `data_source`, `last_synced_at`, `preferences`, `created_at`, `updated_at`
   - RLS: ✅ 啟用
   - 政策: 使用者可查看/更新自己的資料

4. **audit_logs** - 審計日誌表
   - 欄位: `id`, `user_id`, `user_email`, `action`, `resource_type`, `resource_id`, `old_values`, `new_values`, `ip_address`, `user_agent`, `created_at`
   - RLS: ✅ 啟用
   - 政策: 使用者可查看自己的日誌；系統可插入日誌

### Views（視圖）

- `url_total_stats` - URL 總計統計
- `url_daily_stats` - URL 每日統計

### Functions（函數）

- `create_user_profile()` - 建立使用者資料
- `sync_user_email()` - 同步使用者 email
- `update_updated_at_column()` - 更新時間戳記
- `get_current_user_profile()` - 取得當前使用者資料
- `log_audit()` - 記錄審計日誌

### Triggers（觸發器）

- `on_auth_user_created` - 新用戶註冊時自動建立 user_profile
- `on_auth_user_updated` - auth.users email 更新時同步到 user_profiles
- `update_user_profiles_updated_at` - user_profiles 更新時自動更新 updated_at
- `update_urls_updated_at` - urls 更新時自動更新 updated_at

---

## ⚠️ 重要提醒

1. **密鑰安全**
   - 請勿將 `SUPABASE_SERVICE_ROLE_KEY` 暴露在前端
   - 建議更新所有 API Keys（如果舊環境已關閉）

2. **BASE_URL 設定**
   - 確認 `.env` 中的 `BASE_URL` 與實際域名一致
   - QR Code 會包含此 URL

3. **Redis 快取**
   - 如果有使用 Redis，記得清除舊快取
   - 否則可能讀取到舊的 Supabase URL

4. **QR Code 檔案**
   - 資料庫只儲存 QR Code 配置，不儲存圖片
   - 需要另外備份 `/public/qrcodes/` 目錄

5. **認證功能**
   - 還原後需要在 Supabase Auth 建立使用者帳號
   - 建議先建立系統帳號 `system@tzuchi.org`
   - 將現有無所有者的 URLs 歸屬給系統帳號：
     ```sql
     UPDATE urls
     SET created_by = '系統帳號UUID'
     WHERE created_by IS NULL;
     ```

---

## 📞 需要幫助？

如果在還原過程中遇到問題：

1. 檢查本文件的「故障排除」章節
2. 查看 Supabase Dashboard 的 Logs
3. 檢查應用程式的日誌輸出
4. 確認所有環境變數設定正確

---

**備份建立時間**: 2025-12-01 14:55 UTC
**文件版本**: 1.0
**適用於**: Supabase PostgreSQL 15.x+
