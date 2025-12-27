# TCurl 短網址系統 - Deno 版本

慈濟基金會短網址管理系統的 Deno 版本，使用 Hono 框架替代 Fastify。

## 系統需求

- Deno 2.0+ (已測試 2.6.3)
- Redis
- Supabase 帳戶

## 快速開始

```bash
# 安裝 Deno (如果尚未安裝)
curl -fsSL https://deno.land/install.sh | sh

# 快取依賴
deno task cache

# 類型檢查
deno task check

# 開發模式（檔案監控自動重載）
deno task dev

# 正式環境啟動
deno task start
```

## Deno Tasks

| 指令 | 說明 |
|------|------|
| `deno task dev` | 開發模式，監控檔案變更自動重載 |
| `deno task start` | 正式環境啟動 |
| `deno task check` | TypeScript 類型檢查 |
| `deno task lint` | 程式碼檢查 |
| `deno task fmt` | 程式碼格式化 |
| `deno task test` | 執行測試 |
| `deno task cache` | 快取所有依賴 |
| `deno task compile` | 編譯為單一執行檔 |
| `deno task deploy` | 部署（快取 + 檢查 + 啟動） |

## 權限說明

Deno 使用明確的權限模型，符合 ISO 27001 最小權限原則：

```bash
deno run \
  --env \                    # 讀取環境變數
  --allow-net \              # 網路存取（API、Supabase、Redis）
  --allow-read \             # 讀取檔案（靜態資源、.env）
  --allow-write \            # 寫入檔案（QR Code、日誌）
  --allow-env \              # 存取環境變數
  src/main.ts
```

更嚴格的權限設定（推薦用於正式環境）：

```bash
deno run \
  --env \
  --allow-net=0.0.0.0:8080,localhost:6379,*.supabase.co \
  --allow-read=/web/html/urlpj/shorturl-api \
  --allow-write=/web/html/urlpj/shorturl-api/public/qrcodes,/web/html/urlpj/shorturl-api/logs \
  --allow-env \
  src/main.ts
```

## systemd 部署

1. 複製服務檔案：
```bash
sudo cp tcurl-deno.service /etc/systemd/system/
```

2. 重新載入 systemd：
```bash
sudo systemctl daemon-reload
```

3. 啟用並啟動服務：
```bash
sudo systemctl enable tcurl-deno
sudo systemctl start tcurl-deno
```

4. 查看狀態和日誌：
```bash
sudo systemctl status tcurl-deno
sudo journalctl -u tcurl-deno -f
```

## 環境變數

在 `.env` 檔案中設定：

```env
# 伺服器設定
PORT=8080
HOST=0.0.0.0
BASE_URL=https://url.tzuchi.org
DENO_ENV=production

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx...
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# 短代碼設定
SHORT_CODE_LENGTH=6

# 速率限制
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX=100

# CORS
CORS_ORIGIN=https://url.tzuchi.org
```

## 專案結構

```
shorturl-api/
├── src/
│   ├── main.ts              # Deno 入口點 (Hono)
│   ├── routes/
│   │   └── urls.ts          # API 路由
│   ├── services/
│   │   ├── supabase.ts      # Supabase 客戶端
│   │   ├── redis.ts         # Redis 客戶端
│   │   └── nginx-cache.ts   # Nginx 快取清除
│   └── utils/
│       ├── shortcode.ts     # 短代碼生成
│       ├── url-validator.ts # URL 驗證（SSRF 防護）
│       ├── html-templates.ts # HTML 模板
│       └── audit-logger.ts  # 稽核日誌（ISO 27001）
├── public/                  # 靜態檔案
├── deno.json                # Deno 配置
├── deno.lock                # 依賴鎖定
├── tcurl-deno.service       # systemd 服務檔
└── .env                     # 環境變數
```

## 從 Node.js 遷移

主要變更：

| Node.js | Deno |
|---------|------|
| Fastify | Hono |
| ioredis | deno-redis |
| bcrypt (npm) | deno.land/x/bcrypt |
| process.env | Deno.env.get() |
| crypto (Node) | Web Crypto API |
| package.json | deno.json |

## ISO 27001 安全合規

本系統符合以下 ISO 27001 控制項：

- **A.12.4** - 日誌記錄與監控
  - 稽核日誌 (audit-logger.ts)
  - 系統事件記錄

- **A.12.6** - 技術漏洞管理
  - Deno 權限模型
  - 安全標頭 (CSP, HSTS, etc.)

- **A.13.1** - 網路安全管理
  - CORS 配置
  - Rate limiting
  - SSRF 防護

## API 端點

與 Node.js 版本相同：

- `POST /api/urls` - 建立短網址
- `GET /api/urls` - 取得短網址列表
- `GET /api/urls/:id` - 取得單一短網址
- `PUT /api/urls/:id` - 更新短網址
- `DELETE /api/urls/:id` - 刪除短網址
- `GET /s/:shortCode` - 短網址重導向
- `GET /health` - 健康檢查

## 授權

內部專案，版權所有 2024 慈濟基金會
