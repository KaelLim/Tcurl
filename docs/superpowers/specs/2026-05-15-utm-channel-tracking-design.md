# UTM 管道追蹤 + 多組 QR Code 設計

## 目標

讓使用者為同一個短網址建立多個「管道」（channel），每個管道有獨立的名稱和 UTM 參數。每個管道產生獨立的 QR Code。掃描或點擊時，TCurl 記錄來源管道用於自家統計，同時將 UTM 參數附加到目標 URL 讓 GA4 也能追蹤。

QR Code 編碼的是短網址 + 管道代碼，修改管道名稱、UTM 或目標網址都不需要更換 QR Code。

## 限制

- 每個短網址最多 5 個管道
- 管道名稱必填，UTM 欄位全部選填
- 沒有設定 UTM 的管道，redirect 時不附加任何參數

## 資料庫

### 新增 `url_channels` 表

```sql
CREATE TABLE url_channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  url_id UUID NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  group_key VARCHAR(8) NOT NULL,
  name VARCHAR(100) NOT NULL,
  utm_source VARCHAR(100),
  utm_medium VARCHAR(100),
  utm_campaign VARCHAR(200),
  utm_content VARCHAR(200),
  utm_term VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(url_id, group_key)
);

CREATE INDEX idx_url_channels_url_id ON url_channels(url_id);
CREATE INDEX idx_url_channels_group_key ON url_channels(group_key);
```

RLS 策略：
- SELECT/INSERT/UPDATE/DELETE: 透過 `url_id` 關聯 `urls.created_by = auth.uid()` 控制
- Service role 完全存取

### `url_clicks` 新增欄位

```sql
ALTER TABLE url_clicks ADD COLUMN channel_id UUID REFERENCES url_channels(id) ON SET NULL;
CREATE INDEX idx_url_clicks_channel_id ON url_clicks(channel_id);
```

使用 `ON SET NULL`：刪除管道時，歷史點擊記錄保留但 channel_id 設為 NULL。

## API

所有管道 API 需要登入（使用 userClient）。

### GET /api/urls/:id/channels

回傳該短網址的所有管道。

Response:
```json
[
  {
    "id": "uuid",
    "group_key": "x7kF",
    "name": "花蓮營隊海報",
    "utm_source": "poster",
    "utm_medium": "print",
    "utm_campaign": "hualien-camp-2026",
    "utm_content": null,
    "utm_term": null,
    "created_at": "2026-05-15T..."
  }
]
```

### POST /api/urls/:id/channels

新增管道。自動產生 `group_key`（6 位英數隨機碼）。檢查該 URL 管道數量 < 5。

Request body:
```json
{
  "name": "花蓮營隊海報",
  "utm_source": "poster",
  "utm_medium": "print",
  "utm_campaign": "hualien-camp-2026"
}
```

錯誤：
- 409: 管道已達上限 5 個
- 404: URL 不存在

### PUT /api/urls/:id/channels/:channelId

修改管道名稱或 UTM 參數。`group_key` 不可修改（修改會導致 QR Code 失效）。

### DELETE /api/urls/:id/channels/:channelId

刪除管道。關聯的 `url_clicks.channel_id` 自動設為 NULL。

## Redirect 邏輯

修改 `url-redirect.ts` 中的 `GET /s/:shortCode`：

```
1. 查 url（現有邏輯）
2. 解析 query: g = c.req.query('g')
3. 如果有 g：
   a. 查 url_channels WHERE url_id = data.id AND group_key = g
   b. 找到 → channel_id = channel.id
   c. 找不到 → channel_id = null（忽略無效 g 參數）
4. 記錄 url_clicks，包含 channel_id
5. 如果 channel 有 UTM 參數：
   a. 解析 original_url
   b. 附加非空的 utm_* 參數
   c. 302 redirect 到附加後的 URL
6. 否則直接 302 redirect 到 original_url
```

UTM 附加邏輯：使用 URL API 處理，正確處理原始 URL 已有 query string 的情況。

```typescript
function appendUtmParams(originalUrl: string, channel: Channel): string {
  const url = new URL(originalUrl);
  if (channel.utm_source) url.searchParams.set('utm_source', channel.utm_source);
  if (channel.utm_medium) url.searchParams.set('utm_medium', channel.utm_medium);
  if (channel.utm_campaign) url.searchParams.set('utm_campaign', channel.utm_campaign);
  if (channel.utm_content) url.searchParams.set('utm_content', channel.utm_content);
  if (channel.utm_term) url.searchParams.set('utm_term', channel.utm_term);
  return url.toString();
}
```

## 前端

### edit.html — 管道管理區塊

在編輯頁面新增「管道管理」section：

- 標題：「管道追蹤」+ 說明文字
- 管道列表：每個管道顯示名稱、UTM 摘要、QR Code 縮圖
- 新增按鈕：開啟表單填寫 name + UTM 欄位
- 每個管道的操作：
  - 編輯（修改名稱/UTM）
  - 複製連結（`{BASE_URL}/s/{code}?g={key}&qr=1`）
  - 下載 QR Code（前端用 QRCodeStyling 即時產生，編碼管道專屬 URL）
  - 刪除（確認對話框）
- 達到 5 個時隱藏新增按鈕

### analytics.html — 管道統計

- 在現有統計下方新增「管道來源」區塊
- 表格或圓餅圖顯示各管道的點擊數佔比
- 「直接點擊」（channel_id = NULL）作為一個分類

## Stats RPC 更新

更新 `get_url_stats` function，新增 channel breakdown：

```sql
'channels', COALESCE((
  SELECT json_agg(ch_row)
  FROM (
    SELECT json_build_object(
      'channel_id', uc.id,
      'name', uc.name,
      'clicks', COUNT(c.id)
    ) AS ch_row
    FROM url_channels uc
    LEFT JOIN url_clicks c ON c.channel_id = uc.id
    WHERE uc.url_id = p_url_id
    GROUP BY uc.id, uc.name
  ) sub
), '[]'::json)
```

## 新增檔案

| 檔案 | 說明 |
|------|------|
| `migrations/005_add_url_channels.sql` | 建立 url_channels 表 + url_clicks 新增 channel_id |
| `src/routes/url-channels.ts` | 管道 CRUD API |

## 修改檔案

| 檔案 | 變更 |
|------|------|
| `src/routes/url-redirect.ts` | redirect 解析 `g` 參數、查管道、附加 UTM |
| `src/main.ts` | 掛載 urlChannelRoutes |
| `public/edit.html` + `public/js/edit.js` | 管道管理 UI |
| `public/analytics.html` + `public/js/realtime-stats.js` | 管道統計 |
| `migrations/004_add_stats_rpc_functions.sql` 或新 migration | 更新 get_url_stats RPC |

## 測試

新增 `tests/channels_test.ts`：
- 未登入訪問管道 API 應回傳 401
- redirect 帶無效 `g` 參數不應 500
- redirect 帶 `g` 參數仍正常跳轉（不影響現有功能）
