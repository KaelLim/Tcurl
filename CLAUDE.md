# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
npm install

# Development（Cloudflare Vite plugin + workerd，http://localhost:5173）
# secrets 以環境變數提供假值即可（不要建立 .env / .dev.vars 進 repo）
SUPABASE_SERVICE_ROLE_KEY=dummy ADMIN_EMAILS=you@example.com npm run dev   # = cf dev

# Build（輸出 .cloudflare/output/v0/，不上傳、不需憑證）
npm run build        # = cf build

# Type check / Tests
npm run typecheck    # = tsc --noEmit
npm test             # = vitest run（Node 執行，bindings 與 Supabase 皆為 in-memory 替身）

# Deploy（由主流程執行；需 Cloudflare 憑證）
cf deploy --secrets-file <path>   # 或 npx wrangler secret put <NAME> --name tcurl
# Pages 入口（只有改 pages/_worker.js 時才需要；cf 沒有指定 Pages 專案的選項）
npx wrangler@4 pages deploy pages --project-name tcurl --branch main
```

`cf` 是 Cloudflare 官方 CLI（專案 devDependency，亦可用全域安裝）。專案**沒有** wrangler 設定檔；
`cf` 尚不支援的指令（如 `tail`、單一 secret）改用 `npx wrangler ... --name tcurl`。

## Architecture Overview

**TCurl** is a short URL service for Tzu Chi Foundation, built with:
- **Entry**: Pages 專案 `tcurl`（`https://url.tzuchi.org`、`https://tcurl.pages.dev`）→ `pages/_worker.js` 經 service binding `TCURL` 原封不動轉給 Worker。
  邏輯全留在 Worker（Pages 不支援 Rate Limiting binding）。Worker 的 workers.dev 與預覽網址已關閉（`workersDev: false`）
- **Runtime**: Cloudflare Workers（Worker 名稱 `tcurl`）
- **Framework**: Hono（entry `src/main.ts`，`export default app`）
- **Database**: Supabase Cloud (PostgreSQL + Auth)
- **Static files**: Workers Static Assets（`public/`，Vite 的 publicDir）
- **Config**: `cloudflare.config.ts`（cf / `@cloudflare/vite-plugin` 讀取）、`vite.config.ts`
- **Frontend**: Vanilla JS + TailwindCSS + QRCodeStyling

### Bindings（`cloudflare.config.ts` → `c.env`，型別在 `src/types/env.ts`）

| Binding | 類型 | 用途 |
|---|---|---|
| `ASSETS` | Static Assets | 讀取 `public/` 的 HTML（頁面路由、fallback） |
| `ROOMS_KV` | KV | 密語房間（`src/services/room-store.ts`），namespace id `d6b78a14f52c4738a9d992aac56a7354` |
| `REDIRECT_CACHE` | KV | 轉址快取（`src/services/redirect-cache.ts`），namespace `tcurl-redirect-cache`（`04f53a61677445138a45239c92c7f25a`） |
| `RATE_LIMITER` | Rate Limiting | 一般限流（`/api/*`、HTML 頁面；`/s/*`、`/ad/*` 除外），鍵 `CF-Connecting-IP`，100 次 / 60 秒 |
| `REDIRECT_RATE_LIMITER` | Rate Limiting | 轉址限流（只套 `/s/*`、`/ad/*`），鍵 `CF-Connecting-IP`，1000 次 / 60 秒 |
| `PASSWORD_RATE_LIMITER` | Rate Limiting | verify-password 專屬限流（IP + 短碼），5 次 / 60 秒 |
| `API_KEY_RATE_LIMITER` | Rate Limiting | 服務 API 金鑰限流（namespace `1004`），鍵 keyId，每把金鑰 300 次 / 60 秒；有效金鑰的請求不吃 `RATE_LIMITER`（見下方 Service API keys） |
| `API_KEY_VERIFY_RATE_LIMITER` | Rate Limiting | 金鑰驗證的每 IP 前置限流（namespace `1005`），鍵 `CF-Connecting-IP`，1200 次 / 60 秒；帶 `tcurl_sk_` 的請求在查資料庫驗證之前先扣 |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`（publishable key）, `CORS_ORIGIN`（可逗號列多個；`url.tzuchi.org` 已內建於 `src/main.ts`） | text var | 公開設定 |
| `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS` | secret | 只宣告名稱，值在部署時注入，**不可進 repo** |

Smart Placement 已開啟（`placement: { mode: 'smart' }`）：Supabase 在 Frankfurt，Worker 會被放到靠近 DB 的位置執行。

選用 var：`BASE_URL`（未設定時 short_url 以請求網域為準，目前不設）、`SHORT_CODE_LENGTH`、`RATE_LIMIT_ENABLED=false`、`ENVIRONMENT=development`（允許 localhost CORS）。
Workers 沒有行程層級環境變數：**一律從請求的 `c.env` 讀取**，不要在模組層級讀設定。

### Critical: Supabase Dual-Client Pattern

The project uses TWO Supabase clients for different scenarios:

```typescript
// 1. Service Client (bypasses RLS) - for system operations
import { getSupabase } from './services/supabase.ts'
const supabase = getSupabase(c.env)
// Use for: short URL redirects, click tracking, public queries

// 2. User Client (respects RLS) - for authenticated user operations
const userClient = getUserClientFromRequest(c)   // or createUserClient(c.env, token)
// Use for: all CRUD operations that should be scoped to the user
```

**Rule**: Any API that needs user authentication MUST use the user client (`getUserClientFromRequest(c)` / `createUserClient(c.env, token)`) to let Supabase RLS handle permissions automatically.

### Request Flow

```
User Request → url.tzuchi.org / tcurl.pages.dev（Pages 專案 tcurl，pages/_worker.js）
    ↓ service binding TCURL（URL、標頭含 CF-Connecting-IP 原封不動）
Worker tcurl
    ↓
assets.runWorkerFirst 符合？（/api, /api/*, /s/*, /ad/*, /health, 頁面路由, /, /*.html）
├── 否，且 public/ 有對應檔案 → Static Assets 直接回應（_headers 設快取）
└── 是，或找不到檔案 → Worker（Hono, src/main.ts）
        ↓
        ├── Short URL redirect: /s/:code → REDIRECT_CACHE（KV）→ 未命中才查 Supabase → 302；點擊以 executionCtx.waitUntil 背景寫入
        ├── API routes: /api/* → src/routes/*.ts
        ├── HTML pages: ASSETS binding 取 HTML → 注入 ?v=版本號 → no-cache
        └── Fallback: ASSETS 取檔；無副檔名依序試 .html → /index.html → SPA index.html
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Hono app entry (`export default app`), middleware (CSP, CORS, rate limit, logging), static fallback via ASSETS |
| `cloudflare.config.ts` | Worker name, compatibility, assets routing, bindings, vars, secrets |
| `src/types/env.ts` | `Bindings` / `AppEnv` types for `c.env` |
| `src/routes/url-crud.ts` | URL CRUD, QR code options (no PNG files), password verification (bcryptjs) |
| `src/routes/url-redirect.ts` | Short URL redirect, ad pages |
| `src/routes/url-stats.ts` | Statistics queries via RPC (get_url_stats, get_urls_with_stats, etc.) |
| `src/routes/url-pages.ts` | HTML page routes (/links, /edit, /analytics, /feedback, /docs, /ui-kit, /admin, /r) via ASSETS |
| `src/routes/auth.ts` | User auth (/api/auth/me, /api/auth/profile) |
| `src/routes/_helpers.ts` | Shared route utilities (getUserClientFromRequest, sendUnauthorized, runInBackground) |
| `src/routes/feedbacks.ts` | Community feedback/suggestion routes |
| `src/routes/admin.ts` | Admin dashboard API (stats, all URLs/users/feedbacks, ADMIN_EMAILS auth) |
| `src/services/supabase.ts` | Supabase clients (service + user factory, built from `c.env`) |
| `src/services/room-store.ts` | 密語房間 store on Workers KV |
| `src/routes/url-channels.ts` | Channel CRUD (UTM tracking, multi QR code per URL) |
| `src/utils/asset-version.ts` | Version from package.json (bundled at build), injects `?v=` into HTML asset refs |
| `public/_headers` | Static Assets cache headers (JS/CSS 1 year immutable, images 30 days) |
| `src/utils/html-templates.ts` | Password prompt, expired, ad interstitial pages |
| `public/js/auth.js` | Frontend Supabase auth (Google OAuth via Supabase Auth, PKCE)；`auth.getDisplayName(user)` |

## Database Schema

**Main tables**:
- `urls` - short URLs with `qr_code_options` (JSONB), `password_hash`, `expires_at`
- `url_clicks` - click tracking with `event_type` ('link_click', 'qr_scan', 'ad_view', 'ad_click') and optional `channel_id`
- `url_channels` - UTM channel tracking per URL (`group_key`, `name`, `utm_source/medium/campaign/content/term`)

**RPC functions** (SECURITY DEFINER, used by `url-stats.ts`):
- `get_url_stats(p_url_id, p_days)` - single URL stats with daily + channel breakdown
- `get_urls_with_stats(p_user_id, p_page, p_limit)` - paginated URL list with aggregated stats
- `get_stats_summary(p_user_id)` - totalLinks, activeLinks, totalClicks
- `get_daily_stats(p_user_id, p_days)` - daily trend across all user URLs

## Code Conventions

- **Formatting**: 2-space indent, single quotes, 100-char line width
- **Imports**: Use `.ts` extension in import paths (e.g., `import { urlRoutes } from './routes/urls.ts'`; `allowImportingTsExtensions`)
- **Hono**: `new Hono<AppEnv>()`；設定一律 `c.env.X`，不要用模組層級全域設定
- **Background work**: 回應後仍要執行的 Promise 用 `runInBackground(c, promise)`（`executionCtx.waitUntil`），否則 Workers 會中止
- **Tests**: Vitest（`vitest.config.ts`），檔名 `*_test.ts`，放 `src/` 或 `tests/`；`tests/helpers/test-env.ts` 提供假 ASSETS/KV/限流器與 Supabase fetch 攔截，測試不連外

## Known Gotchas

### 1. Column Name: `qr_code_options` (plural)
The database column is `qr_code_options` (with 's'). Using `qr_code_option` (singular) will cause 500 errors.

### 2. QRCodeStyling Live Preview
Use **Canvas mode**, not SVG. SVG has caching issues with `update()`:
```javascript
const config = { type: "canvas", ... }  // NOT "svg"
```

### 3. Browser Caching API Responses
Add cache busters for critical data:
```javascript
fetch(`/api/urls/${id}?_=${Date.now()}`, { cache: 'no-store' })
```

### 4. CSP for External Resources
When adding new external resources, update CSP in `src/main.ts`:
- `imgSrc` - for images
- `styleSrc` - for CSS
- `scriptSrc` - for JS
- `connectSrc` - for fetch/XHR targets

### 5. Static Assets 路由
`assets.htmlHandling` 與 `notFoundHandling` 都是 `'none'`（`/login.html` 不會被轉址，`/login` 由 Worker 補 `.html`）。
新增需要 Worker 處理的路徑（例如新的頁面路由）時，**要同時加進 `cloudflare.config.ts` 的 `runWorkerFirst`**，
否則若 `public/` 剛好有同名檔案會被 Static Assets 直接回應。`/s/*` 不再有任何快取層。

### 6. Frontend api.js: Backend API vs Direct Supabase
`public/js/api.js` uses two patterns — don't mix them up:
- **Backend API** (`fetch('/api/...')` with Bearer token): `getUrls`, `getUrlStats`, `getStatsSummary`, `updateUrl`, all channel methods — these use server-side RPC for performance
- **Direct Supabase** (`this.getClient()`): `createUrl`, `getUrl`, `deleteUrl`, `updateQRCode` — these use the Supabase JS client with RLS

## Cache Strategy

### Short URL Redirect
- `/s/*` 每次都進 Worker（回 302 + `Cache-Control: no-cache`），沒有 Nginx 快取
- **轉址快取（`REDIRECT_CACHE`，KV）**：網址（`url:<short_code>`）與管道（`ch:<url_id>:<group_key>`）快取最多 60 秒
  （值內帶 `cached_at`，超過 60 秒視為未命中）。只存轉址需要的欄位，**不存密碼雜湊**（只存 `requires_password`）；
  到期時間與密碼保護在命中時照樣判斷；找不到的短碼不快取；KV 故障時退回資料庫
- **清快取**：後端 `PUT/DELETE /api/urls/:id`、`PUT/DELETE /api/urls/:id/channels/:channelId` 會呼叫 `invalidateUrl` / `invalidateChannel`。
  前端 `api.js` 的 `deleteUrl` 直接改 Supabase、不經 Worker，刪除後最多約 60 秒內舊連結仍可能轉址。
  **新增會改變轉址結果的寫入路徑時，記得清快取**
- **Click tracking**: 每次轉址都在 Worker 內寫 `url_clicks`（`event_type` 依 `?qr=1|true`、`channel_id` 依 `?g=`），以 `executionCtx.waitUntil` 背景執行，不阻塞 302

### Static Asset Cache (Browser)
Version-based cache busting via `src/utils/asset-version.ts` + `public/_headers`:
- **JS/CSS**: `Cache-Control: public, max-age=31536000, immutable` (1 year) — safe because URL includes `?v={version}`
- **Images**: `Cache-Control: public, max-age=2592000` (30 days)
- **HTML pages**: 一律經 Worker（`runWorkerFirst` 含 `/`、`/*.html`），`Cache-Control: no-cache`
- Version comes from `package.json` `version` (bundled at build) and is injected into HTML `<script src="/js/...">` / `href="/css/..."` references
- **On deploy**: bump `package.json` version → `cf deploy` → browsers auto-fetch new assets

## Authentication

- **Backend**: JWT from `Authorization: Bearer <token>` header
- **Frontend**: Supabase client in `public/js/auth.js`
- **Google OAuth**：經 Supabase Auth（`signInWithOAuth({ provider: 'google' })`，`flowType: 'pkce'`）；provider 由 Supabase 後台設定，client id/secret 不進 repo。登出只呼叫 `supabase.auth.signOut()` 後導回 `/login.html`
- **顯示名稱**：依序 `chinese_lastname + chinese_firstname`（舊 Keycloak 帳號）→ `full_name` → `name`（Google）→ `display_name`（舊 email 註冊帳號）→ email（@ 前段）。後端 `src/utils/display-name.ts`，前端 `auth.getDisplayName(user)`
- **Admin**: Identified by `ADMIN_EMAILS` env var (comma-separated); sidebar auto-detects via `/api/admin/check`

## Service API keys

內部服務用的長期金鑰（spec：`docs/superpowers/specs/2026-11-03-api-keys-design.md`）。管理者在後台「API 金鑰」分頁發放
（`/api/admin/api-keys`，`src/routes/admin.ts`）；給對方服務的說明在 `public/docs/openapi.yaml`（`ApiKeyAuth`）。

- **格式與保存**：`tcurl_sk_` + 32 bytes base64url；`api_keys` 只存 SHA-256 hex 與前 15 字元的顯示前綴。
  完整金鑰只出現在 `POST /api/admin/api-keys` 的回應，**任何記錄、其他回應、資料庫都不可出現**
- **白名單**：`src/middleware/api-key-auth.ts` 的 `API_KEY_ROUTES`（端點 + `read`／`write`）是金鑰能呼叫哪些端點的唯一來源。
  **新端點預設拒絕金鑰（401）**；要開放必須明確加進白名單、在路由實作金鑰分支並補測試，
  同時更新 `openapi.yaml` 該端點的 `security`（`BearerAuth` + `ApiKeyAuth`）與「API 金鑰需要 `read|write` 權限」說明
  （`tests/openapi_api_key_test.ts` 會比對）。`matchApiKeyRoute` 只比對路徑形狀，`tests/api_key_auth_test.ts` 的白名單守門
  要求 app 裡會被放行的路由都逐字列在 `API_KEY_ROUTES`（新增 `GET /api/urls/export` 這類同形狀路由會讓測試失敗）
- **路由的金鑰分支**（上方 Dual-Client 規則的例外）：`getApiKey(c)` 有值時用 `getSupabaseForApiKey(c.env, key.keyId)`
  （service role，**繞過 RLS**），所有對 `urls` 的查詢／修改／刪除都**必須**經 `scopeToApiKey`（或 `scopeToCaller(query, key)`，
  `src/routes/_helpers.ts`），同時限定 `created_by = 負責同仁` 且 `api_key_id = 這把金鑰`；channels、統計先以此確認所屬短網址。
  不屬於這把金鑰的一律 404（非 UUID 的 `:id` 也是 404）
- **中介層順序**：`apiKeyAuth()` 必須註冊在 `main.ts` 一般限流之前。有效金鑰改用 `API_KEY_RATE_LIMITER`（不吃 IP 限流），
  無效金鑰回 401 並照樣計入 `RATE_LIMITER`。Rate Limiting binding 不能「只看不扣」，IP 限流只能在驗證之後才扣，
  所以驗證（查 DB）之前另有 `API_KEY_VERIFY_RATE_LIMITER`（每 IP 1200 次 / 60 秒）限制單一 IP 能觸發幾次
  `verify_api_key`；格式不符 `^tcurl_sk_[A-Za-z0-9_-]{43}$` 的 token 直接判無效、不查 DB。
  `Authorization` 只要含 `tcurl_sk_`（不分大小寫，`tcurl%5Fsk_` 也算；`services/supabase.ts` 的 `API_KEY_MARKER`）
  就由中介層處理：不是 `Bearer tcurl_sk_…`（`Bearer Bearer …`、加引號、其他 scheme、前綴大小寫被改過）
  一律當無效金鑰（記錄 reason `malformed_header`），不交給 JWT 流程；`extractToken` 遇到含 `tcurl_sk_` 的 token 也回 null，
  路由就算漏寫金鑰分支也不會把完整金鑰送到 Supabase。驗證服務本身出錯（reason `error`）回 503 + `Retry-After`，
  不扣 IP 額度、不記為無效金鑰。
  殘餘風險：同一個 IP 每分鐘最多仍可觸發 1200 次驗證查詢（含有效金鑰超過自己 300 次之後的請求）；
  超過 4 個內部服務共用同一個對外 IP 且都接近上限時，要調高這個上限。
  與合法服務共用對外 IP 的人（例如同一個 NAT）送大量帶 `tcurl_sk_` 的請求（格式錯誤的也算），可以耗盡該 IP 的前置額度，
  讓同一 IP 上的有效金鑰暫時（最多一個 60 秒時間窗）拿到 429；記錄裡是 reason `verify_rate_limited`
- **SQL：`auth.role()` vs `current_user`**：判斷「是否為後端（service role）呼叫」一律用 `auth.role()`（PostgREST 的 JWT role），
  **不可**用 `current_user`——SECURITY DEFINER 函式內 `current_user` 是函式擁有者，不是呼叫者。
  `guard_url_api_key_id` trigger（一般使用者不能設定／變更 `urls.api_key_id`）與 `log_url_changes`
  （只在 service role 時採信 `x-tcurl-api-key-id` 標頭，記到 `audit_logs.api_key_id`）都靠這個判斷。
  `guard_url_api_key_id` 另外在新增帶 `api_key_id` 的短網址時，把 `created_by` **覆寫**成金鑰目前的負責同仁
  （`SELECT owner_id … FOR SHARE`，與轉移互斥；金鑰不存在或沒有負責同仁 → 42501），Worker 傳的 `created_by` 只是驗證當下的值。
  新 RPC 比照 `20261102044647_restrict_rpc_to_service_role.sql`：`SECURITY DEFINER`、`SET search_path = ''`、只 GRANT 給 `service_role`。
  SQL 測試：`bash scripts/sql-tests/run-local.sh`（本機用完即丟的 postgres:17 容器，不連正式 Supabase）；
  FOR SHARE 的互斥要兩個連線，另跑 `bash scripts/sql-tests/race-check.sh`（同樣用完即丟）
- **金鑰寫入的資料會顯示在負責同仁的網頁上**（寫入者與觀看者不同人）：`original_url`、管道名稱／UTM、`qr_code_options`
  放進 `innerHTML` 前一律 `escapeHtml`；結構化欄位在後端檢查格式，例如 `qr_code_options` 只接受
  `src/utils/qr-code-options.ts` 列出的 7 個鍵（色碼 `#RRGGBB`、列舉、0–100 整數、布林），其他回 400
- **前端標示**：金鑰建立的短網址在「我的連結」與編輯頁顯示「由 API：〈名稱〉建立」（已撤銷加註「（已撤銷）」）。
  `api_keys` 前端讀不到：列表用 `get_urls_with_stats` 帶出的 `api_key_name`／`api_key_revoked`，
  編輯頁用 `api.getUrlApiKeyInfo(id)`（後端 `GET /api/urls/:id`）

## Environment Variables

設定都在 `cloudflare.config.ts` 的 `worker.env`（見上方 Bindings 表）。沒有 `.env`；本機開發的 secrets 以環境變數傳給 `cf dev`。
部署時 secrets 以 `cf deploy --secrets-file <檔案>` 或 `npx wrangler secret put <NAME> --name tcurl` 設定（檔案不可放在 repo）。

## Service Management

部署在 Cloudflare Workers，無常駐服務。Logs：Workers Observability（已啟用）或 `npx wrangler tail tcurl`。
`shorturl-api.service`、`tcurl-deno.service` 是舊版自架（Deno + systemd）遺留檔，Workers 版不使用。
