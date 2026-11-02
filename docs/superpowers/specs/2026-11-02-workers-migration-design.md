# TCurl 臨時版：Cloudflare Workers + Supabase Cloud 改版設計

日期：2026-11-02
分支：`feature/workers-migration`（從 `feature/passphrase-room-poc` 分出，含密語房間）

## 1. 目的與背景

- 舊系統（自架 Linux + Deno + Nginx + 自架 Supabase）的 Supabase `service_role` 金鑰自 2025-12-09 起公開在 GitHub。
- 本次要盡快以**改動最小**的方式，把 TCurl 搬到 **Cloudflare Workers**，資料庫改用 **Supabase Cloud**，作為**臨時版本**。
- 登入方式：Keycloak 來不及，改用 **Google OAuth**（經 Supabase Auth）。
- 測試網址：`https://tcurl.tzuchidigital.workers.dev`。正式網域 `url.tzuchi.org` 的切換**不在本次範圍**。

## 2. 使用者已決定的事

1. 平台：Cloudflare Workers，後端維持 **Hono**，不改 Astro。
2. **功能全部保留**。只有在 Workers 上無法運作的「底層實作」才替換（見第 4 節），不刪任何使用者功能。
3. 改動最小化。
4. Google OAuth 由使用者在 Supabase 後台設定（client id/secret 不進 repo、不經過 agent）。
5. 先用 workers.dev 網域測試，zone / 自訂網域暫不處理。

## 3. 環境與既定值

| 項目 | 值 |
|---|---|
| Supabase Cloud project ref | `fsneeigsjdryxutmdrmg` |
| Supabase URL | `https://fsneeigsjdryxutmdrmg.supabase.co` |
| Publishable key（前端與後端的 anon 用途，公開值） | `sb_publishable_XYMtpVzQz4ge2R1gD1NcaQ_VRXLTvmX` |
| Service role / secret key | **尚未提供**，部署時以 Worker secret `SUPABASE_SERVICE_ROLE_KEY` 注入，不可寫進 repo |
| Cloudflare 帳號憑證 | `~/.config/tcurl/cloudflare.env`（`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`），**勿印出內容** |
| workers.dev 子網域 | `tzuchidigital` → Worker 名稱 `tcurl` |
| CLI | `cf`（已全域安裝 v0.15.0）。專案沒有 wrangler 設定檔，依 Cloudflare 建議用 `cf` 與 `cloudflare.config.ts`；`cf` 尚不支援的指令改用 `npx wrangler`（不要把 wrangler 加進專案設定） |
| ADMIN_EMAILS | 沿用舊 `.env` 的值（部署時設為 secret/var） |

## 4. Workers 上跑不動、需要替換的部分（不改使用者行為）

| 目前（Deno 版） | 檔案 | 替換做法 |
|---|---|---|
| `Deno.serve` 進入點、`Deno.addSignalListener`、`Deno.exit` | `src/main.ts` | 改為 `export default app`（Workers module）；移除訊號處理 |
| `Deno.env.get(...)` | 多處 | 改讀 Workers bindings（`c.env`）；Supabase client 依請求的 env 建立（不可用模組層級的全域初始化依賴 Deno.env） |
| JSR/URL import（`jsr:@hono/hono`、`deno.land/x/bcrypt`） | `deno.json` | 改 npm：`hono`、`@supabase/supabase-js`、`bcryptjs`（與既有 `$2a$/$2b$` 雜湊相容） |
| Nginx 快取 `/s/*` + `sudo rm` 清快取 | `src/services/nginx-cache.ts` | 刪除。轉址不再依賴 Nginx；清快取呼叫一併移除 |
| `sudo tail` 讀 Nginx log 補記點擊 | `src/services/click-log-watcher.ts` | 刪除。每次轉址都在 Worker 內記錄點擊，用 `executionCtx.waitUntil` 背景寫入，不阻塞 302 |
| QR PNG 寫到 `public/qrcodes`、刪除時 `Deno.remove` | `src/routes/url-crud.ts` | **不再寫檔/刪檔**（目前沒有任何頁面讀取這些 PNG；QR 一律在瀏覽器以 qr-code-styling 即時產生）。`PATCH /api/urls/:id/qr-code` 只保存 `qr_code_options`；API 回應格式維持相容 |
| Deno KV（密語房間） | `src/services/room-store.ts`、`src/main.ts` | 改用 Workers KV binding（`ROOMS_KV`）。用到的操作只有 `list(prefix)`、`set(..., expireIn)`、`get`、`delete`，對應 KV 的 `list({prefix})`、`put(..., {expirationTtl})`（≥60 秒）、`get`、`delete`。接受 KV 最終一致性 |
| 記憶體 Map 限流、以 `X-Forwarded-For` 為鍵 | `src/main.ts` | 改用 Workers Rate Limiting binding，鍵用 `CF-Connecting-IP` |
| 自寫靜態檔處理（`Deno.readFile('./public'+path)`，有路徑穿越風險） | `src/main.ts` | 改用 **Workers Static Assets**（目錄 `public/`）。頁面路由（`/links`、`/edit/:id`、`/analytics/:id`、`/feedback/:id`、`/docs`、`/ui-kit`、`/admin`、`/r`）改由 `ASSETS` binding 取對應 HTML |
| `asset-version.ts` 讀 `deno.json` 版本並注入 `?v=` | `src/utils/asset-version.ts` | 版本號改在 build 時或以常數注入；HTML 仍需帶 `?v=` 以配合長快取（做法由實作者決定，需維持 JS/CSS 長快取、HTML no-cache 的策略） |
| `Deno.readTextFile` 讀 HTML | `src/routes/url-pages.ts` | 改 `ASSETS` binding |
| 稽核日誌 | `src/utils/audit-logger.ts` | 已只寫 console（檔案寫入原本就註解掉），保留；移除 Deno 專屬 API 即可 |
| 測試（`deno test`） | `tests/`、`src/**/*_test.ts` | 改成可在 Node/Workers 工具鏈執行（例如 vitest，或 `@cloudflare/vitest-pool-workers`）。至少保留 room-key、room-store、redirect/auth 相關測試的意圖 |

## 5. 登入：Keycloak → Google

- `public/js/auth.js`：`SUPABASE_URL` 改為 Cloud URL、key 改 publishable key；`signInWithOAuth({ provider: 'google' })`，維持 `flowType: 'pkce'`；移除 Keycloak 專屬設定（realm URL、client id、Keycloak 登出網址、`resource_access/realm_access` 解析）。登出改為只呼叫 `supabase.auth.signOut()` 後導回 `/login.html`。
- 登入頁按鈕文案改為 Google 登入（`public/login.html`、相關元件）。
- 顯示名稱：目前讀 Keycloak 的 `chinese_lastname` + `chinese_firstname`（`src/routes/feedbacks.ts`、`src/routes/admin.ts`、前端 sidebar 等）。改為依序 fallback：`chinese_lastname+chinese_firstname` → `full_name` → `name` → email。
- CSP（`src/main.ts`）：`connectSrc` 改為 Cloud Supabase URL（含 `wss://` realtime 若有用到），移除舊的 `sbeurlpj.tzuchi-org.tw`、`auth.tzuchi.net`。
- 舊帳號沿用：資料搬遷會匯入 `auth.users`；Supabase 對同一已驗證 email 會自動把 Google identity 連到既有使用者，所以原本的連結仍屬原擁有者。

## 6. 本次一併修的資安問題（都是小改動）

詳細原因見審查報告：
`/private/tmp/claude-501/-Users-kaellim-Desktop-projects-urlpj/9260e642-c152-48a4-b994-b908b79414e2/scratchpad/backend-review.md`、`frontend-review.md`

程式層：
1. `/ad/:code`、`POST /api/ad/:code/view`、`POST /api/ad/:code/click`：比照 `/s/:code`，檢查 `is_active`、`expires_at`、`password_protected`；有密碼保護時不得回傳或嵌入目的網址。
2. `PUT /api/urls/:id`：更新欄位改**白名單**（不可由請求改 `qr_code_path`、`created_by`、`user_id`、`password_hash` 等）。
3. `POST /api/urls/:shortCode/verify-password`：加專屬限流（IP + 短碼）。
4. `public/js/admin.js` 的 `escapeHtml`：補跳脫 `"` 與 `'`。
5. 伺服器產生的 HTML（`src/utils/html-templates.ts`）：放進 `href`／`location` 的目的網址只允許 `http:`/`https:`（縱深防禦）。
6. 錯誤回應不要回傳資料庫錯誤原文。

資料庫層（見第 7 節）：拒絕新的非 http(s) 網址、統計 RPC 檢查呼叫者、收緊 `url_clicks`/`audit_logs` 匿名權限。

**不在本次範圍**（臨時版上線後再做）：CSP 去除 `unsafe-inline/eval` 與 SRI、token 改存 cookie、密語房間的配額與防猜、前端改走後端 API 建立短網址（改由 DB 約束擋 `javascript:`）。

## 7. 資料庫：Supabase Cloud schema 與資料搬遷

來源：`/Users/kaellim/Desktop/projects/urlpj/supabase-2026-11-02/pg_dumpall.sql`（2026-11-02 完整 dump，5.4 GB；`postgres` 資料庫段落從第 11095033 行開始；前段 `_supabase` 是 log，不要搬）。**內含個資，任何輸出只能是統計或 schema，不可印出使用者資料。**

現況（線上，供參考）：`public` 有 `urls`(972)、`url_clicks`(106,639)、`url_channels`(13)、`user_profiles`(84)、`audit_logs`(1,115)、`feedbacks`(2)、`feedback_comments`(1)、`feedback_votes`(0)；`auth.users` 84 筆（keycloak 79、email 5，email 皆已驗證）。

Schema 以**線上 dump 的 public schema 為準**（不是 repo 的 `migrations/`，那些是舊的），重建時：
- 保留：資料表、索引、序列、外鍵、RLS policy、`public` 函式（含統計 RPC）、`auth.users` 上的 `on_auth_user_created`（`public.create_user_profile`）與 `on_auth_user_updated`（`public.sync_user_email`）觸發器。
- **不搬**：`auth.copy_email_from_metadata` 函式與 `on_auth_user_copy_email` 觸發器（Keycloak 補丁，有提權風險）。
- 修正：
  - `urls.original_url` 加 `CHECK (original_url ~* '^https?://')` **NOT VALID**（既有 1 筆 `chrome-extension://` 保留不壞，新資料必須 http(s)）。
  - 統計 RPC（SECURITY DEFINER）：非 `service_role` 呼叫時，必須驗證 `p_user_id = auth.uid()` 或該 url 屬於 `auth.uid()`；並固定 `search_path`。
  - `url_clicks`：移除匿名讀寫 policy（點擊由 Worker 以 service role 寫入）。
  - `audit_logs`：移除匿名寫入。
  - `days`/`limit` 類參數加上限。
- 匯入資料：`auth.users`、`auth.identities`、所有 public 表；匯入時 `SET session_replication_role = replica` 避免觸發器重複建立 `user_profiles`；匯入後重設序列。
- 匯入需要 Cloud 的資料庫連線字串（**尚未提供**，之後放 `~/.config/tcurl/supabase.env` 的 `SUPABASE_DB_URL`）。因此本階段只產出 SQL 與匯入腳本，**不執行匯入、不對 Cloud 下任何寫入**。

產出位置：
- Schema：`supabase/migrations/20261102040837_init_from_selfhosted.sql`（可用 Supabase MCP `apply_migration` 套用）
- 資料抽取：`/Users/kaellim/Desktop/projects/urlpj/supabase-2026-11-02/extract/`（目錄權限 700，**不放進 repo**）
- 匯入腳本與步驟：`scripts/import-data.sh` + `docs/superpowers/specs/2026-11-02-data-import.md`

## 8. 部署與驗收（主流程負責，不由 build agent 執行）

1. `cf` 建 KV namespace、Rate Limiting、設定 secrets（`SUPABASE_SERVICE_ROLE_KEY`、`ADMIN_EMAILS`）、部署到 `tcurl.tzuchidigital.workers.dev`。
2. 使用者在 Supabase：Google provider、Site URL 與 Redirect URLs 加入 `https://tcurl.tzuchidigital.workers.dev/**`。
3. 驗收：Google 登入、建立/編輯/刪除短網址、`/s/:code` 轉址與點擊記錄（含 `?qr=1`、`?g=`）、QR 樣式與下載、統計頁、密碼連結、廣告頁、意見回饋、管理後台、密語房間。

## 9. 硬性規則（所有實作 agent）

- 不 push、不部署、不對 Supabase Cloud 寫入、不修改 `/Users/kaellim/Desktop/projects/urlpj/shorturl-api`（舊 checkout）。
- 不印出、不寫入 repo 任何金鑰或個資；`.env*` 一律不進版控。
- 不 commit（由主流程審查後 commit）。
