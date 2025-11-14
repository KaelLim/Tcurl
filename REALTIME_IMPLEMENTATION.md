# Realtime 即時統計功能實作文件

## 概述

本文件描述短網址平台的 Realtime 即時統計功能實作，使用 Supabase Realtime 功能來即時監測 `url_clicks` 表的變化，並動態更新前端 UI。

## 功能特色

- ✅ **即時點擊偵測**：當有人點擊短網址時，前端立即收到通知
- ✅ **自動 UI 更新**：無需重新整理頁面，統計數字自動更新
- ✅ **視覺回饋**：使用綠色脈衝動畫提示數據更新
- ✅ **通知訊息**：彈出提示通知使用者有新點擊
- ✅ **乾淨的訂閱管理**：頁面卸載時自動清理 WebSocket 連接

## 技術架構

### 資料庫層

**Migration: `enable_realtime_for_url_clicks`**

```sql
-- 將 url_clicks 表加入 Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE url_clicks;

-- 添加註解說明
COMMENT ON TABLE url_clicks IS '短網址點擊記錄 - 已啟用 Realtime 即時更新';
```

**驗證方式**：

```sql
-- 確認 url_clicks 已加入 publication
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';
```

### JavaScript 模組層

**檔案位置**: `/web/html/urlpj/shorturl-api/public/js/realtime-stats.js`

#### RealtimeStats 類別

管理 Supabase Realtime WebSocket 連接和事件處理：

```javascript
class RealtimeStats {
  constructor(supabaseUrl, supabaseKey)
  async init()
  async loadSupabaseSDK()
  subscribeToClicks()
  unsubscribe()
  on(event, callback)
  _triggerCallbacks(event, payload)
}
```

**主要功能**：

1. **動態載入 SDK**：自動載入 Supabase JS SDK（如果尚未載入）
2. **WebSocket 管理**：建立和管理 Realtime channel
3. **事件系統**：提供 `on()` 方法註冊回調函數
4. **訂閱管理**：訂閱 `url_clicks` 表的 INSERT 事件

#### 輔助函數

**`updateStatsFromClick(clickData)`**

當收到新點擊事件時，自動更新 UI：

```javascript
function updateStatsFromClick(clickData) {
  const { url_id, is_qr_scan } = clickData.new

  // 1. 更新特定 URL 的點擊數（帶動畫）
  const statsElement = document.querySelector(`[data-url-id="${url_id}"]`)
  if (statsElement) {
    const currentClicks = parseInt(statsElement.textContent || '0')
    statsElement.textContent = currentClicks + 1

    // 添加綠色脈衝動畫
    statsElement.classList.add('stats-updated')
    setTimeout(() => statsElement.classList.remove('stats-updated'), 1000)
  }

  // 2. 更新總點擊數
  const totalClicksElement = document.getElementById('totalClicks')
  if (totalClicksElement) {
    const currentTotal = parseInt(totalClicksElement.textContent.replace(/,/g, '') || '0')
    totalClicksElement.textContent = (currentTotal + 1).toLocaleString()
  }

  // 3. 如果在統計頁面，重新載入圖表
  if (typeof refreshCharts === 'function') {
    refreshCharts()
  }
}
```

### 前端整合層

**檔案位置**: `/web/html/urlpj/shorturl-api/public/links.html`

#### CSS 動畫

```css
/* 即時更新動畫 */
@keyframes pulse-green {
    0%, 100% {
        background-color: rgba(34, 197, 94, 0.2);
        transform: scale(1);
    }
    50% {
        background-color: rgba(34, 197, 94, 0.4);
        transform: scale(1.05);
    }
}

.stats-updated {
    animation: pulse-green 1s ease-in-out;
    border-radius: 0.25rem;
    padding: 0.125rem 0.25rem;
}
```

#### JavaScript 初始化

```javascript
// Supabase 配置
const SUPABASE_URL = 'http://localhost:8000'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

// 初始化 Realtime Stats
const realtimeStats = new RealtimeStats(SUPABASE_URL, SUPABASE_ANON_KEY)

// 頁面載入後啟動 Realtime
window.addEventListener('DOMContentLoaded', async () => {
  try {
    // 1. 初始化客戶端
    await realtimeStats.init()

    // 2. 訂閱點擊事件
    realtimeStats.subscribeToClicks()

    // 3. 註冊事件處理器
    realtimeStats.on('onInsert', (payload) => {
      console.log('🎉 收到即時點擊事件！', payload)
      updateStatsFromClick(payload)

      // 4. 顯示通知
      const shortCode = payload.new.url_id
      utils.showNotification(`有人點擊了您的短網址！`, 'success')
    })

    console.log('✅ Realtime 統計已啟用 - 點擊數據將即時更新')
  } catch (error) {
    console.error('❌ Realtime 初始化失敗:', error)
  }
})

// 頁面卸載時清理
window.addEventListener('beforeunload', () => {
  if (realtimeStats) {
    realtimeStats.unsubscribe()
  }
})
```

## 資料流程

### 1. 使用者點擊短網址

```
使用者 → GET /s/{shortCode}
```

### 2. 後端記錄點擊

```typescript
// src/routes/urls.ts - redirect endpoint
await supabase.from('url_clicks').insert({
  url_id: urlData.id,
  user_agent: request.headers['user-agent'] || null,
  is_qr_scan: false
})
```

### 3. PostgreSQL Realtime 觸發

```
INSERT → url_clicks 表
       ↓
PostgreSQL Logical Replication
       ↓
Supabase Realtime Server
       ↓
WebSocket 推送
```

### 4. 前端收到事件

```javascript
realtimeStats.on('onInsert', (payload) => {
  // payload.new 包含新插入的記錄
  // payload.new.url_id
  // payload.new.is_qr_scan
  // payload.new.clicked_at
})
```

### 5. UI 自動更新

```
updateStatsFromClick()
  ↓
更新點擊數字 + 動畫
  ↓
顯示通知訊息
```

## 測試方法

### 1. 準備測試環境

```bash
# 確認 API 伺服器運行中
pm2 status

# 確認 Supabase 本地服務運行中
supabase status
```

### 2. 開啟連結列表頁面

在瀏覽器中開啟：
```
http://localhost:8080/links.html
```

### 3. 打開瀏覽器開發者工具

查看 Console，應該看到：
```
✅ Realtime Stats initialized
🔔 Subscribing to url_clicks changes...
✅ Successfully subscribed to url_clicks changes
✅ Realtime 統計已啟用 - 點擊數據將即時更新
```

### 4. 模擬點擊事件

在另一個分頁或使用 curl 點擊短網址：

```bash
# 替換 SHORT_CODE 為實際的短代碼
curl -I 'http://localhost:8080/s/SHORT_CODE'
```

### 5. 觀察 Realtime 效果

在列表頁面中，你應該看到：
- ✅ 點擊數字自動 +1
- ✅ 數字出現綠色脈衝動畫（持續 1 秒）
- ✅ 右上角彈出通知：「有人點擊了您的短網址！」
- ✅ Console 顯示：`🎉 收到即時點擊事件！`

### 6. 驗證資料庫

```sql
-- 查詢最新的點擊記錄
SELECT id, url_id, clicked_at, is_qr_scan
FROM url_clicks
ORDER BY clicked_at DESC
LIMIT 5;

-- 確認 Realtime publication
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime';
```

## 常見問題排解

### 問題 1：Console 顯示 "Supabase client not initialized"

**原因**：未呼叫 `init()` 方法

**解決方式**：
```javascript
await realtimeStats.init()  // 必須先初始化
realtimeStats.subscribeToClicks()  // 才能訂閱
```

### 問題 2：訂閱狀態顯示 "CHANNEL_ERROR"

**原因**：
1. Supabase URL 或 API Key 錯誤
2. `url_clicks` 表未加入 Realtime publication

**解決方式**：
```sql
-- 檢查是否已加入 publication
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- 如果沒有，手動加入
ALTER PUBLICATION supabase_realtime ADD TABLE url_clicks;
```

### 問題 3：收不到 Realtime 事件

**檢查清單**：
1. ✅ 確認 Supabase 本地服務運行中
2. ✅ 確認 `url_clicks` 在 publication 中
3. ✅ 確認瀏覽器 Console 無錯誤訊息
4. ✅ 確認 WebSocket 連接成功（狀態 = "SUBSCRIBED"）
5. ✅ 使用瀏覽器開發者工具的 Network 分頁，檢查 WebSocket 連接

### 問題 4：動畫不顯示

**原因**：HTML 中的點擊數元素缺少 `data-url-id` 屬性

**解決方式**：
```html
<!-- 在列表的點擊數欄位加上 data-url-id -->
<span data-url-id="${url.id}">${url.clicks}</span>
```

## 效能考量

### WebSocket 連接管理

- 每個頁面維持 1 個 WebSocket 連接
- 連接會在頁面卸載時自動關閉
- 使用 Supabase 的連接池機制，支援大量並發訂閱

### 資料傳輸量

- 每次點擊事件約傳輸 200-300 bytes
- 只傳輸新插入的記錄（`payload.new`）
- 不影響後端 API 效能

### 瀏覽器相容性

- 支援所有現代瀏覽器（Chrome, Firefox, Safari, Edge）
- 需要支援 WebSocket 和 ES6+
- 如需支援舊版瀏覽器，需添加 polyfill

## 安全性考量

### API Key 保護

- 使用 `SUPABASE_ANON_KEY`（公開金鑰）
- 透過 Row Level Security (RLS) 控制資料存取權限
- Realtime 事件僅包含 `url_clicks` 表的公開欄位

### 資料隱私

根據 `STATISTICS_REFACTORING.md`，已移除敏感欄位：
- ❌ `ip_address` - 已移除
- ❌ `country` - 已移除
- ❌ `city` - 已移除
- ❌ `referrer` - 已移除
- ✅ 只保留 `user_agent` 和 `is_qr_scan`

## 未來擴展建議

### 1. 更多統計頁面支援

目前只在 `links.html` 實作，可擴展到：
- `analytics.html` - 圖表即時更新
- `index.html` - 首頁統計即時更新

### 2. 更精細的事件類型

```javascript
// 訂閱 UPDATE 和 DELETE 事件
realtimeStats.on('onUpdate', (payload) => {
  // 處理 URL 更新
})

realtimeStats.on('onDelete', (payload) => {
  // 處理 URL 刪除
})
```

### 3. 批次更新優化

如果短時間內有大量點擊：
```javascript
// 使用 debounce 減少 UI 更新頻率
const debouncedUpdate = debounce(updateStatsFromClick, 500)
realtimeStats.on('onInsert', debouncedUpdate)
```

### 4. 連接狀態指示器

```html
<!-- 顯示 Realtime 連接狀態 -->
<div id="realtimeStatus" class="indicator">
  <span class="dot online"></span> 即時連線
</div>
```

### 5. 錯誤重連機制

```javascript
// 自動重連
if (status === 'CHANNEL_ERROR') {
  setTimeout(() => {
    console.log('🔄 嘗試重新連接...')
    realtimeStats.subscribeToClicks()
  }, 5000)
}
```

## 相關文件

- [STATISTICS_REFACTORING.md](./STATISTICS_REFACTORING.md) - 統計系統重構文件
- [Supabase Realtime 官方文件](https://supabase.com/docs/guides/realtime)
- [PostgreSQL Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)

## 版本歷史

- **v1.0** (2025-11-14) - 初版發布
  - 實作 `url_clicks` 表的 Realtime 訂閱
  - 建立 `RealtimeStats` 類別
  - 整合到 `links.html` 列表頁面
  - 添加視覺動畫和通知功能

---

**文件版本**: 1.0
**更新日期**: 2025-11-14
**作者**: Claude Code
