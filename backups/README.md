# 備份檔案總覽

## 📅 備份資訊

- **備份時間**: 2025-12-01 14:55 UTC
- **備份來源**: Docker Supabase (localhost)
- **資料庫版本**: PostgreSQL 15.8
- **備份工具**: pg_dump

---

## 📦 備份檔案清單

### 1. 資料庫備份

| 檔案名稱 | 大小 | 說明 | 使用時機 |
|---------|------|------|---------|
| **backup_full.sql** | 61KB | 完整備份（Schema + Data） | ✅ **推薦** - 還原到全新 Supabase |
| **backup_schema_only.sql** | 34KB | 僅資料表結構（不含資料） | 只需要建立空白資料表時使用 |
| **backup_data_only.sql** | 27KB | 僅資料內容（不含結構） | 資料表已存在，只需要匯入資料 |

### 2. 設定檔備份

| 檔案名稱 | 說明 |
|---------|------|
| **backup_env** | 應用程式環境變數設定 |

### 3. 說明文件

| 檔案名稱 | 說明 |
|---------|------|
| **RESTORE_GUIDE.md** | 完整的還原步驟指南 |
| **README.md** | 本文件 - 備份總覽 |

---

## 🚀 快速開始

### 還原到新 Supabase 實例

**最簡單的方式（推薦）**:

1. 登入 Supabase Dashboard: https://app.supabase.com
2. 建立新專案或選擇現有專案
3. 進入 SQL Editor → New query
4. 複製 `backup_full.sql` 的內容並貼上
5. 點擊 "Run" 執行
6. 更新應用程式的 `.env` 檔案（參考 `backup_env`）
7. 重啟應用程式

**詳細步驟**: 請參閱 `RESTORE_GUIDE.md`

---

## 📊 備份內容摘要

### 資料表 (4 個)

1. **urls** - 短網址主表（11 筆資料）
   - 包含短代碼、原始 URL、密碼保護、過期時間、QR Code 配置等

2. **url_clicks** - 點擊記錄表
   - 記錄每次短網址訪問和 QR Code 掃描

3. **user_profiles** - 使用者資料擴展表
   - 儲存使用者顯示名稱、組織資訊（JSONB）、偏好設定等

4. **audit_logs** - 審計日誌表
   - 記錄所有重要操作（登入、建立/更新/刪除 URL 等）

### Views (2 個)

- `url_total_stats` - URL 總計統計
- `url_daily_stats` - URL 每日統計

### Functions (5 個)

- `create_user_profile()` - 自動建立使用者資料
- `sync_user_email()` - 同步使用者 email
- `update_updated_at_column()` - 自動更新時間戳記
- `get_current_user_profile()` - 取得當前使用者資料
- `log_audit()` - 記錄審計日誌

### Triggers (4 個)

- `on_auth_user_created` - 新用戶註冊觸發器
- `on_auth_user_updated` - 用戶資料更新觸發器
- `update_user_profiles_updated_at` - user_profiles 自動更新
- `update_urls_updated_at` - urls 自動更新

### Row Level Security (RLS)

✅ 所有資料表已啟用 RLS
- 使用者只能查看/管理自己的資料
- 短網址允許匿名訪問（用於重定向）
- 系統可透過 service_role key 管理所有資料

---

## ⚠️ 重要注意事項

### 1. QR Code 圖片檔案

**狀態**: 目前 `/public/qrcodes/` 目錄為空

**說明**:
- QR Code 的**配置**已儲存在資料庫的 `qr_code_options` 欄位
- QR Code 的 **PNG 圖片**儲存在檔案系統
- 如果之後有生成 QR Code 圖片，需要另外備份 `/public/qrcodes/` 目錄

**備份方式**（如果需要）:
```bash
# 備份 QR Code 圖片
cp -r /web/html/urlpj/shorturl-api/public/qrcodes /web/html/urlpj/shorturl-api/backups/qrcodes_backup

# 還原時
cp -r backups/qrcodes_backup/* /web/html/urlpj/shorturl-api/public/qrcodes/
```

### 2. 環境變數更新

還原後**必須**更新 `.env` 檔案中的以下項目：

```env
# 新 Supabase 實例資訊
SUPABASE_URL=https://xxx.supabase.co  # 改為新的 URL
SUPABASE_ANON_KEY=eyJxxx...           # 改為新的 anon key
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...   # 改為新的 service_role key

# 環境設定
NODE_ENV=production                    # 建議改為 production
```

### 3. Redis 快取

如果應用程式有使用 Redis：

```bash
# 清除所有快取
redis-cli FLUSHDB

# 或只清除 URL 相關快取
redis-cli KEYS "url:*" | xargs redis-cli DEL
redis-cli KEYS "urls:*" | xargs redis-cli DEL
```

### 4. 認證系統設定

還原完成後需要：

1. **建立系統帳號**（在 Supabase Dashboard）
   - Email: `system@tzuchi.org`
   - 勾選 "Auto Confirm User"
   - 複製系統帳號的 UUID

2. **將現有 URLs 歸屬給系統帳號**
   ```sql
   UPDATE urls
   SET created_by = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'  -- 替換為系統帳號 UUID
   WHERE created_by IS NULL;
   ```

3. **驗證 RLS 政策運作正常**
   ```sql
   -- 檢查 RLS 是否啟用
   SELECT tablename, rowsecurity
   FROM pg_tables
   WHERE schemaname = 'public';
   ```

---

## 📋 還原檢查清單

完成還原後，請依序檢查：

- [ ] 資料表已建立（urls, url_clicks, user_profiles, audit_logs）
- [ ] 資料已匯入（至少 11 筆 URLs）
- [ ] Views 已建立（url_total_stats, url_daily_stats）
- [ ] Functions 已建立（5 個函數）
- [ ] Triggers 已建立（4 個觸發器）
- [ ] RLS 已啟用（所有表）
- [ ] RLS 政策已建立
- [ ] 環境變數已更新（`.env`）
- [ ] 應用程式已重啟
- [ ] Redis 快取已清除（如有使用）
- [ ] 短網址重定向正常運作
- [ ] API 端點回應正常
- [ ] 前端頁面載入正常

---

## 📞 故障排除

如遇到問題，請參閱：

1. **RESTORE_GUIDE.md** - 完整的還原指南和故障排除
2. **Supabase Dashboard Logs** - 查看資料庫錯誤訊息
3. **應用程式日誌** - 檢查 API 錯誤訊息

常見問題：
- "already exists" 錯誤 → 使用 `backup_full.sql`（包含 DROP 語句）
- RLS 無法查詢 → 確認後端使用 `service_role` key
- 短網址 404 → 檢查資料是否還原、RLS 政策是否正確

---

## 🔄 未來備份建議

建議定期建立備份：

```bash
# 每日備份腳本範例
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/web/html/urlpj/shorturl-api/backups"

# 備份資料庫
sudo docker exec supabase-db pg_dump -U postgres -d postgres \
  --schema=public --clean --if-exists \
  > "$BACKUP_DIR/backup_$DATE.sql"

# 備份 QR Code 圖片（如果有）
tar -czf "$BACKUP_DIR/qrcodes_$DATE.tar.gz" \
  /web/html/urlpj/shorturl-api/public/qrcodes/

# 保留最近 30 天的備份
find "$BACKUP_DIR" -name "backup_*.sql" -mtime +30 -delete
find "$BACKUP_DIR" -name "qrcodes_*.tar.gz" -mtime +30 -delete
```

---

**備份負責人**: Claude AI Assistant
**文件版本**: 1.0
**最後更新**: 2025-12-01
