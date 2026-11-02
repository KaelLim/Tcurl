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
```

`cf` 是 Cloudflare 官方 CLI（專案 devDependency，亦可用全域安裝）。專案**沒有** wrangler 設定檔；
`cf` 尚不支援的指令（如 `tail`、單一 secret）改用 `npx wrangler ... --name tcurl`。

## Architecture Overview

**TCurl** is a short URL service for Tzu Chi Foundation, built with:
- **Runtime**: Cloudflare Workers（Worker 名稱 `tcurl` → `https://tcurl.tzuchidigital.workers.dev`）
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
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`（publishable key）, `BASE_URL`, `CORS_ORIGIN` | text var | 公開設定 |
| `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAILS` | secret | 只宣告名稱，值在部署時注入，**不可進 repo** |

Smart Placement 已開啟（`placement: { mode: 'smart' }`）：Supabase 在 Frankfurt，Worker 會被放到靠近 DB 的位置執行。

選用 var：`SHORT_CODE_LENGTH`、`RATE_LIMIT_ENABLED=false`、`ENVIRONMENT=development`（允許 localhost CORS）。
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
User Request → Cloudflare
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

## Environment Variables

設定都在 `cloudflare.config.ts` 的 `worker.env`（見上方 Bindings 表）。沒有 `.env`；本機開發的 secrets 以環境變數傳給 `cf dev`。
部署時 secrets 以 `cf deploy --secrets-file <檔案>` 或 `npx wrangler secret put <NAME> --name tcurl` 設定（檔案不可放在 repo）。

## Service Management

部署在 Cloudflare Workers，無常駐服務。Logs：Workers Observability（已啟用）或 `npx wrangler tail tcurl`。
`shorturl-api.service`、`tcurl-deno.service` 是舊版自架（Deno + systemd）遺留檔，Workers 版不使用。
