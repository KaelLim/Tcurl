# Short URL API 專案文檔

## 專案概述

基於 Node.js + Fastify + Supabase 的短網址服務，支援 QR Code 生成和 Redis 快取。

## 技術架構

```
┌─────────────────────────────────────────────────┐
│ 用戶請求                                         │
└────────────────┬────────────────────────────────┘
                 ↓
┌─────────────────────────────────────────────────┐
│ Fastify API (Port 3000)                         │
│ - TypeScript + ES Modules                       │
│ - PM2 Process Manager (Production)              │
└────────┬───────────────────┬────────────────────┘
         ↓                   ↓
┌────────────────┐    ┌─────────────────┐
│ Redis Cache    │    │ Supabase        │
│ (Port 6379)    │    │ (Port 8000)     │
│ - Docker       │    │ - PostgreSQL    │
│ - localhost    │    │ - Kong Gateway  │
│ - 1小時 TTL    │    │ - Self-hosted   │
└────────────────┘    └─────────────────┘
```

## 目錄結構

```
/web/html/urlpj/shorturl-api/
├── src/
│   ├── index.ts                 # 主程式入口
│   ├── routes/
│   │   └── urls.ts             # URL 路由（含 Redis 快取）
│   ├── services/
│   │   ├── supabase.ts         # Supabase 客戶端
│   │   └── redis.ts            # Redis 客戶端
│   ├── utils/
│   │   ├── shortcode.ts        # 短代碼生成器（crypto）
│   │   └── qrcode.ts           # QR Code 生成
│   └── types/
│       └── index.ts            # TypeScript 類型定義
├── dist/                       # 編譯後的 JavaScript
├── public/qrcodes/             # QR Code 圖片存放
├── logs/                       # PM2 日誌
├── .env                        # 環境變數
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs        # PM2 配置
```

## 環境配置

### .env 檔案

```env
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Supabase Configuration
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Short URL Configuration
BASE_URL=https://sbeurlpj.tzuchi-org.tw
SHORT_CODE_LENGTH=6

# QR Code Configuration
QR_CODE_SIZE=300
QR_CODE_QUALITY=M

# Redis Configuration (可選)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## 資料庫結構

### urls 表

```sql
CREATE TABLE public.urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    qr_code_generated BOOLEAN DEFAULT false,
    qr_code_path TEXT,
    clicks INTEGER DEFAULT 0,
    qr_scans INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    user_id UUID,
    is_active BOOLEAN DEFAULT true,
    password_protected BOOLEAN DEFAULT false,
    password_hash TEXT
);

CREATE INDEX idx_urls_short_code ON public.urls(short_code);
CREATE INDEX idx_urls_is_active ON public.urls(is_active);
```

### url_clicks 表

```sql
CREATE TABLE public.url_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_id UUID REFERENCES public.urls(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    referrer TEXT,
    user_agent TEXT,
    ip_address INET,
    is_qr_scan BOOLEAN DEFAULT false
);

CREATE INDEX idx_url_clicks_url_id ON public.url_clicks(url_id);
CREATE INDEX idx_url_clicks_clicked_at ON public.url_clicks(clicked_at);
```

## API 端點

### 短網址管理

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/urls` | 建立短網址 |
| GET | `/api/urls` | 列出所有短網址 |
| GET | `/api/urls/:id` | 取得單個短網址詳情 |
| PUT | `/api/urls/:id` | 更新短網址 |
| DELETE | `/api/urls/:id` | 停用短網址 |

### 短網址功能

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/s/:shortCode` | 短網址重定向（使用 Redis 快取） |
| GET | `/api/qrcode/:shortCode` | 取得 QR Code (Base64) |

### 系統功能

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/` | API 文檔 |
| GET | `/health` | 健康檢查 |

## Redis 快取策略

### 快取機制

```typescript
// 快取流程
1. 訪問 /s/:shortCode
   ↓
2. 查詢 Redis: GET "url:{shortCode}"
   ↓
3a. 快取命中 → 直接重定向 (快)
3b. 快取未命中 → 查詢資料庫 → 存入 Redis → 重定向

// 快取失效
- 更新短網址時：自動清除快取
- 刪除短網址時：自動清除快取
- TTL 過期：1小時後自動失效
```

### 快取鍵設計

```
url:{shortCode}         → 短網址快取
clicks:{urlId}          → 點擊計數
qr_scans:{urlId}        → QR 掃描計數
```

### 效能數據（ext4 本地檔案系統）

| 情境 | 回應時間 | 平均值 | 最佳值 |
|------|---------|-------|-------|
| 有 Redis 快取 | 2.5-7.6ms | **~5.3ms** | 2.5ms |
| 無快取（資料庫） | 4.5-73ms | **~16ms** | 4.5ms |
| 快取命中率 | ~80-90% | 估計 | - |
| **效能提升** | **快 3 倍** | - | - |

## 部署說明

### Development 模式

```bash
# 安裝依賴
npm install
# 或使用 sudo: sudo npm install

# 開發模式（自動重啟）
npm run dev
```

### Production 部署

```bash
# 1. 編譯 TypeScript
npm run build

# 2. 啟動 PM2
pm2 start ecosystem.config.cjs

# 3. 保存 PM2 配置
pm2 save

# 4. 設定開機自動啟動
pm2 startup
# 然後執行顯示的 sudo 指令
# 例如: sudo env PATH=$PATH:/usr/bin ...
```

### PM2 管理指令

```bash
# 查看狀態
pm2 status

# 查看日誌
pm2 logs shorturl-api

# 重啟服務
pm2 restart shorturl-api

# 停止服務
pm2 stop shorturl-api

# 刪除服務
pm2 delete shorturl-api

# 監控
pm2 monit
```

## Docker 容器管理

### Redis 容器

```bash
# 啟動 Redis
sudo docker run -d \
  --name redis-cache \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  redis:7-alpine redis-server --appendonly yes

# 查看 Redis 狀態
sudo docker ps | grep redis

# 連接 Redis CLI
sudo docker exec -it redis-cache redis-cli

# 查看所有快取的 URL
sudo docker exec redis-cache redis-cli KEYS "url:*"

# 查看特定快取內容
sudo docker exec redis-cache redis-cli GET "url:abc123"

# 清除所有快取
sudo docker exec redis-cache redis-cli FLUSHALL

# 查看 Redis 統計
sudo docker exec redis-cache redis-cli INFO stats
```

## 效能優化建議

### 當前架構

**檔案系統**: ext4 本地檔案系統
```
路徑: /web/html/urlpj/shorturl-api/
類型: ext4
優點:
- ✅ 支援 Symlink（npm 正常運作）
- ✅ 低延遲、穩定效能
- ✅ Redis 快取平均 ~5.3ms
```

### 進一步優化選項

#### 選項 1: 改用 Cluster 模式（多核心）
```bash
# 編輯 ecosystem.config.cjs
exec_mode: 'cluster'
instances: 4  # 或 'max' 使用所有核心
```

**適用情境**: 高流量、多核心 CPU

#### 選項 2: 增加 Redis 快取時間
```typescript
// src/services/redis.ts
export const CACHE_TTL = {
  URL: 7200, // 改為 2 小時
  STATS: 300  // 改為 5 分鐘
}
```

**適用情境**: 短網址很少更新

## 問題排查

### 常見問題

#### 1. 權限問題

```bash
# 錯誤: EACCES: permission denied
# 原因: 檔案擁有者不對
# 解決: 統一使用 sudo 或修正擁有權
sudo chown -R $USER:$USER /web/html/urlpj/shorturl-api
```

#### 2. PM2 無法啟動

```bash
# 檢查詳細錯誤
pm2 logs shorturl-api --err --lines 50

# 手動測試
node dist/index.js
```

#### 3. Redis 連接失敗

```bash
# 檢查 Redis 是否運行
sudo docker ps | grep redis

# 檢查日誌
pm2 logs shorturl-api | grep -i redis

# 重啟 Redis
sudo docker restart redis-cache
```

#### 4. PM2 服務無法啟動

```bash
# 查看詳細錯誤
pm2 logs shorturl-api --err --lines 50

# 檢查 .env 檔案
cat .env

# 手動測試
node dist/index.js
```

### 效能測試

```bash
# 測試無快取（查資料庫）
sudo docker exec redis-cache redis-cli DEL "url:abc123"
curl -w "Time: %{time_total}s\n" -o /dev/null -s http://localhost:3000/s/abc123

# 測試有快取（Redis）
curl -w "Time: %{time_total}s\n" -o /dev/null -s http://localhost:3000/s/abc123

# 批次測試
for i in {1..10}; do
  curl -s -o /dev/null -w "Test $i: %{time_total}s\n" http://localhost:3000/s/abc123
done
```

## 安全注意事項

### Redis 安全

- ✅ Redis 只綁定 `127.0.0.1`（不對外開放）
- ✅ 使用 Docker 隔離環境
- ⚠️ 建議在生產環境設定 Redis 密碼

### API 安全

- ⚠️ 目前 CORS 允許所有來源（開發環境）
- ⚠️ 生產環境建議限制 CORS origin
- ⚠️ 考慮加入 Rate Limiting（防止濫用）

### Supabase 安全

- ✅ 使用 service_role_key（完整權限）
- ✅ RLS 策略已啟用
- ⚠️ 確保 API Key 不要提交到 Git

## 監控與日誌

### 日誌位置

```
PM2 日誌: /web/html/urlpj/shorturl-api/logs/
- out.log: 標準輸出
- err.log: 錯誤日誌
```

### 監控指標

```bash
# PM2 監控
pm2 monit

# 查看記憶體使用
pm2 status

# Redis 統計
sudo docker exec redis-cache redis-cli INFO stats

# 查看 Redis 記憶體
sudo docker stats redis-cache --no-stream
```

## 備份策略

### 重要資料

1. **資料庫** (最重要)
   - Supabase PostgreSQL 自動備份
   - 定期匯出 SQL dump

2. **QR Code 圖片**
   - 存放在 `public/qrcodes/`
   - 可從資料庫重新生成

3. **環境變數**
   - `.env` 檔案（不要提交到 Git）
   - 記錄在安全的地方

4. **程式碼**
   - 使用 Git 版本控制
   - 推送到遠端倉庫

## 版本資訊

| 項目 | 版本 |
|------|------|
| Node.js | 22.x |
| TypeScript | 5.9.3 |
| Fastify | 5.6.2 |
| Supabase JS | 2.81.1 |
| ioredis | (latest) |
| Redis | 7-alpine |
| PM2 | 6.0.13 |

## 聯絡資訊

- **專案位置**: `/web/html/urlpj/shorturl-api/`
- **API 網址**: `https://sbeurlpj.tzuchi-org.tw`
- **Supabase**: `http://localhost:8000`
- **Redis**: `localhost:6379` (Docker)

## 更新記錄

### 2025-11-14
- ✅ 移到 ext4 本地檔案系統（效能提升 2 倍）
- ✅ 重新安裝 npm（啟用 Symlink 支援）
- ✅ 改用 PM2 Cluster 模式（多核心）
- ✅ 變更 API Port: 3000 → 8080
- ✅ 設定 PM2 開機自動啟動
- ✅ 效能測試：Redis 快取平均 5.3ms

### 2025-11-13
- ✅ 建立短網址 API（Fastify + TypeScript）
- ✅ 整合 Supabase PostgreSQL
- ✅ 實作 QR Code 生成功能
- ✅ 整合 Redis 快取（Docker）
- ✅ 設定 PM2 生產環境部署
- ✅ 實作快取失效機制（更新/刪除時清除）

## 待優化項目

### 短期（建議）
- [ ] 加入 Rate Limiting（防止濫用）
- [ ] 限制 CORS origin（安全性）
- [ ] 設定 Redis 密碼（生產環境）

### 中期（可選）
- [ ] 加入統計分析面板
- [ ] 自訂短網址 domain
- [ ] 批次匯入/匯出功能
- [ ] API 使用文檔（Swagger）

### 長期（未來）
- [ ] 短網址分析儀表板
- [ ] A/B 測試功能
- [ ] UTM 參數追蹤
- [ ] 多租戶支援

---

**文檔更新日期**: 2025-11-14
**維護者**: 佛教慈濟基金會
**協助工具**: Claude Code
