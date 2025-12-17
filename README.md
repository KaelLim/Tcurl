# Tcurl - 慈濟短網址系統

<p align="center">
  <img src="public/images/tzuchi-logo.png" alt="Tcurl Logo" width="120">
</p>

<p align="center">
  <strong>高效能、安全的企業級短網址服務</strong>
</p>

<p align="center">
  <a href="#功能特色">功能特色</a> •
  <a href="#技術架構">技術架構</a> •
  <a href="#快速開始">快速開始</a> •
  <a href="#api-文件">API 文件</a> •
  <a href="#部署指南">部署指南</a>
</p>

---

## 功能特色

### 核心功能
- **短網址生成** - 支援自訂短代碼或自動生成 6 位元代碼
- **QR Code 生成** - 支援自訂 Logo、顏色、樣式的 QR Code
- **密碼保護** - 為敏感連結設定密碼保護
- **過期時間** - 設定連結有效期限，過期自動失效
- **點擊追蹤** - 完整的點擊分析（連結點擊 vs QR 掃描）

### 效能優化
- **Redis 快取層** - 熱門連結快取，降低資料庫負載
- **Nginx 反向代理快取** - 支援即時快取清除
- **Materialized Views** - 預計算統計資料，每分鐘自動刷新
- **高併發支援** - 壓力測試達 1000+ RPS

### 安全機制
- **Supabase Auth** - 完整的使用者驗證系統
- **Row Level Security (RLS)** - 資料庫層級的存取控制
- **Rate Limiting** - API 速率限制，防止濫用
- **CORS & Helmet** - 完整的 HTTP 安全標頭
- **密碼雜湊** - bcrypt 加密儲存

---

## 技術架構

```
┌─────────────────────────────────────────────────────────────────┐
│                        Nginx (反向代理)                          │
│                    - SSL 終止 / 快取 / 負載均衡                   │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Fastify + TypeScript                         │
│                       (Node.js 後端)                             │
└─────────────────────────────────────────────────────────────────┘
                         │              │
                         ▼              ▼
              ┌──────────────┐  ┌──────────────┐
              │    Redis     │  │   Supabase   │
              │   (快取層)    │  │ (PostgreSQL) │
              └──────────────┘  └──────────────┘
```

### 技術棧

| 層級 | 技術 |
|------|------|
| **後端框架** | Fastify + TypeScript |
| **資料庫** | PostgreSQL (Supabase) |
| **快取** | Redis (ioredis) |
| **驗證** | Supabase Auth + JWT |
| **前端** | Vanilla JS + TailwindCSS |
| **反向代理** | Nginx + Cache Purge |
| **程序管理** | PM2 |

---

## 快速開始

### 系統需求

- Node.js 18+
- Redis 6+
- PostgreSQL 14+ (或 Supabase)
- Nginx (選用，用於生產環境)

### 安裝步驟

```bash
# 1. 複製專案
git clone https://github.com/KaelLim/Tcurl.git
cd Tcurl

# 2. 安裝依賴
npm install

# 3. 設定環境變數
cp .env.example .env
# 編輯 .env 填入你的設定

# 4. 編譯 TypeScript
npm run build

# 5. 啟動服務
npm start
```

### 環境變數

```env
# 伺服器設定
PORT=3000
HOST=0.0.0.0
BASE_URL=https://your-domain.com

# Supabase 設定
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis 設定
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# 短代碼設定
SHORT_CODE_LENGTH=6
```

---

## API 文件

### 短網址操作

| 方法 | 端點 | 說明 |
|------|------|------|
| `POST` | `/api/urls` | 建立短網址 |
| `GET` | `/api/urls` | 取得使用者所有短網址 |
| `GET` | `/api/urls/:id` | 取得單一短網址詳情 |
| `PUT` | `/api/urls/:id` | 更新短網址 |
| `DELETE` | `/api/urls/:id` | 刪除短網址 |
| `GET` | `/s/:shortCode` | 短網址重導向 |

### 建立短網址範例

```bash
curl -X POST https://your-domain.com/api/urls \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "original_url": "https://example.com/very-long-url",
    "short_code": "custom",
    "expires_at": "2025-12-31T23:59:59Z"
  }'
```

### 回應範例

```json
{
  "id": "uuid",
  "short_code": "custom",
  "original_url": "https://example.com/very-long-url",
  "short_url": "https://your-domain.com/s/custom",
  "created_at": "2025-01-01T00:00:00Z",
  "expires_at": "2025-12-31T23:59:59Z"
}
```

完整 API 文件請參考：`/docs` 或 `/swagger`

---

## 部署指南

### 使用 PM2 部署

```bash
# 編譯並啟動
npm run build
pm2 start ecosystem.config.cjs

# 查看狀態
pm2 status
pm2 logs shorturl-api
```

### Nginx 設定範例

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    # SSL 憑證
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 快取設定
    proxy_cache_path /var/cache/nginx/shorturl levels=1:2
                     keys_zone=shorturl_cache:10m max_size=100m;

    # 短網址重導向（快取 5 分鐘）
    location /s/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache shorturl_cache;
        proxy_cache_valid 200 302 5m;
    }

    # API 請求（不快取）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache off;
    }

    # 靜態檔案
    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

---

## 資料庫結構

### 主要表格

```sql
-- 短網址表
CREATE TABLE urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_code VARCHAR(20) UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    password_hash TEXT,
    qr_code_generated BOOLEAN DEFAULT false
);

-- 點擊記錄表
CREATE TABLE url_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_id UUID REFERENCES urls(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    event_type VARCHAR(20) DEFAULT 'link_click',
    is_qr_scan BOOLEAN DEFAULT false
);
```

### Materialized Views

```sql
-- 多時間維度統計（每分鐘自動刷新）
CREATE MATERIALIZED VIEW url_recent_stats AS
SELECT
    url_id,
    short_code,
    count(*) FILTER (WHERE clicked_at >= CURRENT_DATE) AS today_total,
    count(*) FILTER (WHERE clicked_at >= date_trunc('week', CURRENT_DATE)) AS week_total,
    count(*) FILTER (WHERE clicked_at >= date_trunc('month', CURRENT_DATE)) AS month_total,
    count(*) AS all_time_total
FROM urls LEFT JOIN url_clicks ON urls.id = url_clicks.url_id
GROUP BY url_id, short_code;
```

---

## 效能測試結果

| 測試類型 | 並發數 | RPS | 平均延遲 | 成功率 |
|----------|--------|-----|----------|--------|
| 基準測試 | 10 | 847 | 11.7ms | 100% |
| 負載測試 | 50 | 1,047 | 47.5ms | 100% |
| 壓力測試 | 100 | 996 | 99.8ms | 100% |
| 尖峰測試 | 200 | 881 | 224ms | 100% |

---

## 專案結構

```
Tcurl/
├── src/                    # TypeScript 原始碼
│   ├── index.ts           # 應用程式入口
│   ├── routes/            # API 路由
│   ├── services/          # 服務層（Redis, Supabase）
│   ├── utils/             # 工具函數
│   └── types/             # TypeScript 型別定義
├── public/                # 前端靜態檔案
│   ├── *.html            # HTML 頁面
│   └── js/               # JavaScript 檔案
├── scripts/              # 腳本（測試、維護）
├── migrations/           # SQL 遷移檔
├── backups/              # 備份指南
├── package.json
├── tsconfig.json
└── ecosystem.config.cjs  # PM2 設定
```

---

## 授權條款

本專案為慈濟內部使用。

---

## 聯絡資訊

如有問題或建議，請聯繫開發團隊。
