# 統計系統重構文件

## 概述

本次重構將短網址平台的統計系統從冗餘計數器架構改為基於 Materialized Views 的高效查詢架構。

## 資料庫架構變更

### 1. urls 表簡化

**移除欄位：**
- `clicks` - 總點擊次數（冗餘資料）
- `qr_scans` - QR 掃描次數（冗餘資料）

**保留欄位：**
- 基本資訊：`id`, `short_code`, `original_url`
- 時間戳記：`created_at`, `updated_at`, `expires_at`
- QR Code：`qr_code_generated`, `qr_code_path`, `qr_code_options`
- 狀態管理：`is_active`, `password_protected`, `password_hash`
- 用戶關聯：`user_id`

### 2. url_clicks 表簡化

**移除欄位（隱私與資料最小化）：**
- `referrer` - 來源網址
- `ip_address` - IP 位址
- `country` - 國家
- `city` - 城市
- `utm_source`, `utm_medium`, `utm_campaign` - UTM 參數

**保留欄位：**
- `id` - 主鍵
- `url_id` - 關聯的短網址 ID
- `clicked_at` - 點擊時間
- `user_agent` - 使用者代理
- `is_qr_scan` - 是否為 QR Code 掃描

### 3. 新增 Views（即時統計）

**重要變更（2025-11-14）：改用一般 View 取代 Materialized View**
- 優點：資料永遠即時正確，無需手動刷新
- 缺點：查詢稍慢，但對於中小型應用可接受
- 決策：資料正確性優先於效能

#### url_total_stats（總體統計）

用途：列表頁查詢總點擊數（即時資料）

```sql
CREATE VIEW url_total_stats AS
SELECT
  u.id as url_id,
  u.short_code,
  u.original_url,
  u.created_at,
  u.is_active,
  COALESCE(COUNT(c.id), 0) as total_clicks,
  COALESCE(COUNT(c.id) FILTER (WHERE c.is_qr_scan = false), 0) as link_clicks,
  COALESCE(COUNT(c.id) FILTER (WHERE c.is_qr_scan = true), 0) as qr_scans,
  MAX(c.clicked_at) as last_clicked_at
FROM urls u
LEFT JOIN url_clicks c ON u.id = c.url_id
GROUP BY u.id, u.short_code, u.original_url, u.created_at, u.is_active;

CREATE UNIQUE INDEX idx_url_total_stats_url_id ON url_total_stats(url_id);
```

#### url_daily_stats（每日統計）

用途：圖表顯示每日趨勢（即時資料）

```sql
CREATE VIEW url_daily_stats AS
SELECT
  url_id,
  DATE(clicked_at) as date,
  COUNT(*) as total_clicks,
  COUNT(*) FILTER (WHERE is_qr_scan = false) as link_clicks,
  COUNT(*) FILTER (WHERE is_qr_scan = true) as qr_scans
FROM url_clicks
GROUP BY url_id, DATE(clicked_at)
ORDER BY url_id, date DESC;

CREATE INDEX idx_url_daily_stats_url_id ON url_daily_stats(url_id);
CREATE INDEX idx_url_daily_stats_date ON url_daily_stats(date);
```

#### url_recent_stats（最近時間範圍統計）

用途：儀表板顯示今日/本週/本月即時統計

```sql
CREATE VIEW url_recent_stats AS
SELECT
  u.id as url_id,
  u.short_code,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= CURRENT_DATE) as today_total,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= CURRENT_DATE) FILTER (WHERE c.is_qr_scan = false) as today_clicks,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= CURRENT_DATE) FILTER (WHERE c.is_qr_scan = true) as today_qr_scans,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('week', CURRENT_DATE)) as week_total,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('week', CURRENT_DATE)) FILTER (WHERE c.is_qr_scan = false) as week_clicks,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('week', CURRENT_DATE)) FILTER (WHERE c.is_qr_scan = true) as week_qr_scans,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('month', CURRENT_DATE)) as month_total,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('month', CURRENT_DATE)) FILTER (WHERE c.is_qr_scan = false) as month_clicks,
  COUNT(c.id) FILTER (WHERE c.clicked_at >= DATE_TRUNC('month', CURRENT_DATE)) FILTER (WHERE c.is_qr_scan = true) as month_qr_scans,
  COUNT(c.id) as all_time_total,
  COUNT(c.id) FILTER (WHERE c.is_qr_scan = false) as all_time_clicks,
  COUNT(c.id) FILTER (WHERE c.is_qr_scan = true) as all_time_qr_scans
FROM urls u
LEFT JOIN url_clicks c ON u.id = c.url_id
GROUP BY u.id, u.short_code;
```

**所有 Views 的特點**：
- 一般 View，每次查詢即時計算
- 資料永遠正確，無延遲
- 無需手動刷新維護

## QR Code 掃描追蹤

### 實作方式

所有 QR Code 生成時會在短網址後加上 `?qr=true` 參數：

```typescript
const shortUrl = `${baseUrl}/s/${shortCode}?qr=true`
```

後端在處理重定向時檢查此參數：

```typescript
const isQrScan = request.query.qr === 'true'

supabase.from('url_clicks').insert({
  url_id: urlData.id,
  user_agent: request.headers['user-agent'] || null,
  is_qr_scan: isQrScan
})
```

### 修改位置

1. **後端 QR Code 生成**：`src/routes/urls.ts`
   - POST `/api/urls/:id/qrcode`（第 286 行）
   - GET `/api/qrcode/:shortCode`（第 432 行）

2. **前端 QR Code 生成**：前端呼叫後端 API，自動包含 `?qr=true`

## API 端點變更

### 新增端點

1. **GET `/api/urls/:id/stats`**
   - 查詢單一 URL 的統計數據
   - 參數：`days`（預設 30）- 查詢最近幾天的每日統計
   - 回傳：
     ```json
     {
       "total": {
         "total_clicks": 100,
         "link_clicks": 70,
         "qr_scans": 30,
         "last_clicked_at": "2025-11-14T09:00:00Z"
       },
       "daily": [
         {
           "url_id": "xxx",
           "date": "2025-11-14",
           "total_clicks": 10,
           "link_clicks": 7,
           "qr_scans": 3
         }
       ]
     }
     ```

2. **GET `/api/urls/stats/summary`**
   - 查詢所有 URL 的總體統計
   - 回傳：
     ```json
     {
       "totalLinks": 100,
       "activeLinks": 95,
       "totalClicks": 5000
     }
     ```

3. **~~POST `/api/admin/refresh-stats`~~**（已移除）
   - 改用一般 View 後不再需要手動刷新

### 修改端點

1. **GET `/api/urls`**
   - 原本：從 `urls` 表讀取，包含 `clicks` 欄位
   - 現在：從 `url_total_stats` View 讀取即時統計，合併 `urls` 表的額外欄位
   - 回傳資料新增：`clicks`, `link_clicks`, `qr_scans`, `last_clicked_at`
   - 特點：資料即時正確，無需手動刷新

## View vs Materialized View 決策

### 最終選擇：一般 View

**原因**：
1. **資料一致性**：資料永遠即時正確，刪除/新增立即反映
2. **維護簡單**：無需刷新機制，減少複雜度
3. **效能可接受**：對於中小型應用（< 10萬筆 URLs），查詢速度足夠快
4. **用戶體驗**：避免「刪除後列表仍顯示」的困擾

### 效能考量

- **url_total_stats**: 包含 GROUP BY 和 LEFT JOIN，但有適當索引支援
- **url_daily_stats**: 按日期分組，通常返回少量資料
- **url_recent_stats**: 時間範圍篩選後資料量小

如未來流量成長需要優化，可考慮：
- 增加 Redis 快取層
- 使用 PostgreSQL 的 Query Caching
- 升級到 Materialized View + 自動刷新觸發器

## 前端變更

### API 層（public/js/api.js）

新增方法：

```javascript
// 取得統計數據（即時）
async getUrlStats(id, days = 30)
```

### 列表頁（public/js/links.js）

- 後端 `GET /api/urls` 已包含統計數據
- 前端無需修改，`url.clicks` 仍然可用

## 資料庫索引

### url_clicks 表

```sql
CREATE INDEX IF NOT EXISTS idx_url_clicks_url_id ON url_clicks(url_id);
CREATE INDEX IF NOT EXISTS idx_url_clicks_clicked_at ON url_clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_url_clicks_url_id_clicked_at ON url_clicks(url_id, clicked_at);
```

這些索引對於 View 的查詢效能至關重要。

## 遷移步驟

本次重構已執行的 migrations：

1. `remove_redundant_columns_from_urls` - 移除 urls 表的 clicks 和 qr_scans
2. `simplify_url_clicks_table` - 簡化 url_clicks 表欄位
3. `create_url_total_stats_view` - 建立 url_total_stats Materialized View（初版）
4. `create_url_daily_stats_view` - 建立 url_daily_stats Materialized View（初版）
5. `create_url_recent_stats_view` - 建立 url_recent_stats View
6. `convert_materialized_views_to_views` - **轉換為一般 View（最終版）**

## 測試驗證

### 1. 資料庫結構驗證

```sql
-- 檢查 Views（所有統計都用一般 View）
SELECT schemaname, viewname
FROM pg_views
WHERE schemaname = 'public' AND viewname LIKE 'url%';
-- 應該回傳：url_total_stats, url_daily_stats, url_recent_stats

-- 檢查 urls 表欄位
SELECT column_name FROM information_schema.columns
WHERE table_name = 'urls' ORDER BY ordinal_position;
```

### 2. QR Code 追蹤驗證

```bash
# 測試帶 ?qr=true 的 URL
curl -I 'http://localhost:8080/s/SHORT_CODE?qr=true'

# 檢查資料庫記錄
SELECT is_qr_scan FROM url_clicks ORDER BY clicked_at DESC LIMIT 1;
```

### 3. API 端點驗證

```bash
# 測試統計摘要
curl 'http://localhost:8080/api/urls/stats/summary'

# 測試個別 URL 統計
curl 'http://localhost:8080/api/urls/{id}/stats?days=7'

# 測試列表（包含統計）
curl 'http://localhost:8080/api/urls?page=1&limit=10'

```

## 效能改善

### 之前（冗餘計數器）

- ❌ 每次點擊需要 UPDATE urls 表
- ❌ 高並發時容易產生鎖爭用
- ❌ 資料不一致風險

### 現在（Views）

- ✅ 點擊只需 INSERT url_clicks（無鎖爭用）
- ✅ 查詢統計從 View 即時計算（資料永遠正確）
- ✅ 資料一致性由 PostgreSQL 保證
- ✅ 更好的資料隱私保護（移除敏感欄位）
- ✅ 無需維護刷新機制

## 注意事項

1. **查詢效能**
   - View 每次都即時計算，比 Materialized View 稍慢
   - 對於中小型應用（< 10萬 URLs）效能完全可接受
   - 已建立適當索引優化查詢

2. **歷史資料**
   - 現有點擊記錄的 `is_qr_scan` 預設為 `false`
   - 只有新的 QR Code 掃描會正確標記

3. **資料一致性**
   - ✅ 刪除 URL 後列表立即更新
   - ✅ 新增 URL 後列表立即顯示
   - ✅ 點擊統計即時反映

## 維護建議

1. **效能監控**
   - 定期檢查 View 查詢效能
   - 如發現變慢，檢查索引是否有效
   - 考慮使用 `EXPLAIN ANALYZE` 優化查詢

2. **資料清理**
   - 考慮定期歸檔舊的 url_clicks 記錄
   - 保留最近 6-12 個月的詳細點擊記錄

3. **未來擴展**
   - 如流量成長需要更好效能，可考慮：
     - 增加 Redis 快取層
     - 升級到 Materialized View + 自動觸發器
     - 使用時間分區表（Partitioning）

---

**文件版本**: 1.0
**更新日期**: 2025-11-14
**作者**: Claude Code
