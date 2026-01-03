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
- **廣告頁面** - 可選的中間頁面，顯示目標資訊

### 效能優化
- **Nginx 反向代理快取** - 99% 請求由 Nginx 快取處理，支援即時快取清除
- **即時點擊追蹤** - 透過 tail -f 監聽 Nginx 日誌，即時記錄所有點擊
- **高併發支援** - Deno 原生高效能運行時

### 安全機制
- **Supabase Auth** - 完整的使用者驗證系統
- **Row Level Security (RLS)** - 資料庫層級的存取控制
- **Rate Limiting** - API 速率限制，防止濫用
- **Secure Headers** - 完整的 HTTP 安全標頭
- **密碼雜湊** - bcrypt 加密儲存
- **稽核日誌** - ISO 27001 A.12.4 合規

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
│                      Hono + TypeScript                           │
│                        (Deno 後端)                               │
└─────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                        ┌──────────────┐
                        │   Supabase   │
                        │ (PostgreSQL) │
                        └──────────────┘
```

### 技術棧

| 層級 | 技術 |
|------|------|
| **執行環境** | Deno 2.x |
| **後端框架** | Hono |
| **資料庫** | PostgreSQL (Supabase) |
| **快取** | Nginx（無 Redis，簡化架構） |
| **驗證** | Supabase Auth + JWT |
| **前端** | Vanilla JS + TailwindCSS |
| **反向代理** | Nginx + Cache Purge |

---

## 快速開始

### 系統需求

- Deno 2.0+
- PostgreSQL 14+ (或 Supabase)
- Nginx (選用，用於生產環境快取)

### 安裝步驟

```bash
# 1. 複製專案
git clone https://github.com/KaelLim/Tcurl.git
cd Tcurl

# 2. 設定環境變數
cp .env.example .env
# 編輯 .env 填入你的設定

# 3. 啟動開發模式
deno task dev

# 4. 啟動生產模式
deno task start
```

### Deno 任務

```bash
deno task dev      # 開發模式（自動重載）
deno task start    # 生產模式
deno task check    # 類型檢查
deno task lint     # 程式碼檢查
deno task fmt      # 格式化程式碼
```

### 環境變數

```env
# 伺服器設定
PORT=3000
HOST=0.0.0.0

# Supabase 設定
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# 短代碼設定
SHORT_CODE_LENGTH=6

# 點擊追蹤（可選）
CLICK_WATCHER_ENABLED=true
```

### Google OAuth 設置（Supabase Self-Hosted）

若使用自架 Supabase，需在 Supabase 的 `.env` 中設定 Google OAuth：

```env
# Google OAuth
GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOTRUE_EXTERNAL_GOOGLE_SECRET=your-google-client-secret
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://your-supabase-domain/auth/v1/callback
```

**Google Cloud Console 設定：**

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立或選擇專案
3. 前往「API 和服務」→「憑證」
4. 建立「OAuth 2.0 用戶端 ID」（網頁應用程式）
5. 設定：
   - **已授權的 JavaScript 來源**：`https://your-frontend-domain`
   - **已授權的重新導向 URI**：`https://your-supabase-domain/auth/v1/callback`

**重啟 Supabase Auth：**
```bash
cd /path/to/supabase && docker compose restart auth
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
| `GET` | `/ad/:shortCode` | 廣告頁面（顯示目標資訊） |

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

---

## 部署指南

### 直接執行

```bash
# 啟動服務
deno task start

# 背景執行
nohup deno task start > /var/log/tcurl.log 2>&1 &
```

### 使用 systemd

```ini
# /etc/systemd/system/tcurl.service
[Unit]
Description=Tcurl Short URL Service
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/tcurl
ExecStart=/home/user/.deno/bin/deno task start
Restart=on-failure
Environment=DENO_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable tcurl
sudo systemctl start tcurl
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
        access_log /var/log/nginx/shorturl-clicks.log shorturl_tracking;
        proxy_pass http://127.0.0.1:3000;
        proxy_cache shorturl_cache;
        proxy_cache_key "shorturl$request_uri";
        proxy_cache_valid 302 5m;
    }

    # 快取清除
    location ~ /purge/s/(.+)$ {
        allow 127.0.0.1;
        deny all;
        proxy_cache_purge shorturl_cache "shorturl/s/$1";
    }

    # 廣告頁面（不快取）
    location ^~ /ad/ {
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        proxy_pass http://127.0.0.1:3000;
        proxy_no_cache 1;
    }

    # API 請求（不快取）
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_no_cache 1;
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
    qr_code_generated BOOLEAN DEFAULT false,
    qr_code_options JSONB
);

-- 點擊記錄表
CREATE TABLE url_clicks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url_id UUID REFERENCES urls(id) ON DELETE CASCADE,
    clicked_at TIMESTAMPTZ DEFAULT NOW(),
    user_agent TEXT,
    event_type VARCHAR(20) DEFAULT 'link_click'
);
```

### 事件類型

| event_type | 說明 |
|------------|------|
| `link_click` | 直接點擊短網址 |
| `qr_scan` | 掃描 QR Code |
| `ad_view` | 廣告頁面曝光 |
| `ad_click` | 廣告頁面點擊 |

---

## 專案結構

```
Tcurl/
├── src/                        # TypeScript 原始碼
│   ├── main.ts                # 應用程式入口
│   ├── routes/                # API 路由
│   │   └── urls.ts
│   ├── services/              # 服務層
│   │   ├── supabase.ts       # Supabase 客戶端
│   │   ├── nginx-cache.ts    # Nginx 快取清除
│   │   └── click-log-watcher.ts  # 點擊日誌監聽
│   ├── utils/                 # 工具函數
│   │   ├── html-templates.ts # HTML 模板
│   │   ├── shortcode.ts      # 短代碼生成
│   │   ├── url-validator.ts  # URL 驗證
│   │   └── audit-logger.ts   # 稽核日誌
│   └── types/                 # TypeScript 型別定義
├── public/                    # 前端靜態檔案
│   ├── *.html                # HTML 頁面
│   └── js/                   # JavaScript 檔案
├── backups/                   # 資料庫備份指南
├── deno.json                  # Deno 設定
└── deno.lock                  # 依賴鎖定檔
```

---

## 分支說明

| 分支 | 說明 |
|------|------|
| `main` | Deno + Hono 版本（目前使用） |
| `nodejs` | Node.js + Fastify 版本（舊版） |

---

## 授權條款

本專案為慈濟內部使用。

---

## 聯絡資訊

如有問題或建議，請聯繫開發團隊。
