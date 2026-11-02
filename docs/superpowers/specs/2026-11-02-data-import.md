# TCurl 資料搬遷：自架 Supabase → Supabase Cloud

日期：2026-11-02
上層設計：`docs/superpowers/specs/2026-11-02-workers-migration-design.md` 第 7 節
Cloud project：`fsneeigsjdryxutmdrmg`（Postgres 17）

> 本文件只描述步驟。**此階段不執行匯入、不對 Cloud 寫入**；匯入需要 `SUPABASE_DB_URL`（尚未提供）。
> 抽取檔含個資：只放在 repo 外、權限 700/600；任何輸出只看筆數，不要把資料列貼到聊天、issue 或 log。

## 1. 產物

| 產物 | 位置 | 說明 |
|---|---|---|
| Schema migration | `supabase/migrations/20261102040837_init_from_selfhosted.sql` | 線上 dump 的 public schema，已改成 Cloud 可用並加上 spec §7 的修正（檔內以 `[FIX-n]` 標註） |
| 資料抽取檔 | `/Users/kaellim/Desktop/projects/urlpj/supabase-2026-11-02/extract/`（700） | 每張表一個 psql 檔（600），內容為 `SET session_replication_role = replica;` + `COPY ... FROM stdin`；另有 `MANIFEST.tsv`（順序、筆數）與 `SHA256SUMS` |
| 匯入腳本 | `scripts/import-data.sh` | 唯讀預檢 → 單一交易匯入 → 交易內比對筆數 → 列出預期/實際筆數 |

抽取檔的欄位已限制為 Cloud 上 `auth.users` / `auth.identities` 實際存在、可寫入的欄位（以 Supabase MCP `list_tables` 查得；`auth.users.confirmed_at`、`auth.identities.email` 是 generated column，不匯入，由 Cloud 自動產生）。目前 dump 與 Cloud 的欄位完全對得上，沒有被丟掉的欄位。

## 2. 預期筆數（= 自架 dump 2026-11-02）

依 FK 安全順序：

| # | 檔案 | 表 | 筆數 |
|---|---|---|---:|
| 1 | `01_auth_users.sql` | `auth.users` | 84 |
| 2 | `02_auth_identities.sql` | `auth.identities` | 87 |
| 3 | `03_public_user_profiles.sql` | `public.user_profiles` | 84 |
| 4 | `04_public_urls.sql` | `public.urls` | 972 |
| 5 | `05_public_url_channels.sql` | `public.url_channels` | 13 |
| 6 | `06_public_url_clicks.sql` | `public.url_clicks` | 106,639 |
| 7 | `07_public_feedbacks.sql` | `public.feedbacks` | 2 |
| 8 | `08_public_feedback_comments.sql` | `public.feedback_comments` | 1 |
| 9 | `09_public_feedback_votes.sql` | `public.feedback_votes` | 0 |
| 10 | `10_public_audit_logs.sql` | `public.audit_logs` | 1,115 |

資料檢查（只統計筆數）：

- `auth.users`：provider keycloak 79、email 5（其中 3 個 keycloak 帳號也有 email provider）；84 筆 email 皆非空且已驗證（`email_confirmed_at` 皆有值）；無重複 email、無 phone、無 anonymous / SSO / 已刪除 / 停權帳號。
- `auth.identities`：keycloak 82、email 5；無孤兒、每個 user 至少一個 identity。
- `public.urls`：1 筆非 http(s)（`chrome-extension://`，保留）；23 筆 `created_by` 為 NULL（舊資料，只有 service role 看得到）；1 筆停用、1 筆密碼保護（`$2a$` bcrypt）。
- `public.url_clicks`：link_click 106,518、qr_scan 60、ad_view 49、ad_click 12。
- 所有 FK 皆無孤兒資料；`user_profiles` 與 `auth.users` 一對一。
- public schema 沒有任何 sequence（全部用 uuid），「重設序列」步驟預期處理 0 個。

**不搬的資料**：`auth.sessions`(143)、`auth.refresh_tokens`(1,066)、`auth.mfa_amr_claims`(143)、`auth.flow_state`(100)、`auth.audit_log_entries`(2,803)、`auth.schema_migrations`、`cron.job`(2) 與 `cron.job_run_details`(945,156)、realtime / storage / vault（皆空或系統資料）、`_supabase` log 資料庫。→ 所有人都要重新登入（本來就要改用 Google）。

## 3. 前置條件

1. **匯入前不要有人登入 Cloud 版**：Google 登入會在 `auth.users` 建新帳號，造成 email 衝突；腳本偵測到目標表有資料會直接中止。
2. 安裝 psql（本機目前沒有）：
   ```bash
   brew install libpq
   export PATH="$(brew --prefix libpq)/bin:$PATH"   # libpq 是 keg-only
   psql --version
   ```
3. 連線字串放在 `~/.config/tcurl/supabase.env`（腳本不會建立此檔，也不會印出內容）：
   ```bash
   # ~/.config/tcurl/supabase.env（chmod 600）
   SUPABASE_DB_URL=postgresql://postgres.fsneeigsjdryxutmdrmg:<密碼>@<region>.pooler.supabase.com:5432/postgres
   # 或 URL 不含密碼，另外放：SUPABASE_DB_PASSWORD=<密碼>（以 PGPASSWORD 傳給 psql）
   ```
   - 用 Dashboard → Connect 的 **Session pooler（5432）** 或 Direct connection；**不要用 Transaction pooler（6543）**（腳本會擋）。
   - Direct connection（`db.<ref>.supabase.co`）只有 IPv6，家用網路多半連不到，建議 Session pooler。
   - 連線字串會以參數傳給 psql，執行期間本機 `ps` 看得到；請在自己的單人電腦上執行（或把密碼放 `SUPABASE_DB_PASSWORD`）。
4. 匯入與套用 migration 必須是**同一個角色（postgres）**：腳本要暫時移除 `urls_original_url_http_check`，需要是 `public.urls` 的擁有者。

## 4. 步驟

### 4.0 本機檢查抽取檔（不連線）

```bash
scripts/import-data.sh --dry-run
```
會驗證 `SHA256SUMS`、列出匯入順序與筆數。

### 4.1 套用 schema

擇一：
- Supabase MCP `apply_migration`（name：`init_from_selfhosted`，內容為 migration 檔全文）
- 或 `psql -X -v ON_ERROR_STOP=1 --single-transaction -d "$SUPABASE_DB_URL" -f supabase/migrations/20261102040837_init_from_selfhosted.sql`

套用後：
- Dashboard → Advisors（或 MCP `get_advisors` security）應不再出現 SECURITY DEFINER 可被 anon 執行、search_path 可變、materialized view 暴露於 API 等警告。
- 確認 `auth.users` 上只有 `on_auth_user_created`、`on_auth_user_updated` 兩個我們的 trigger（**沒有** `on_auth_user_copy_email`）。

### 4.2 匯入資料

```bash
scripts/import-data.sh          # 預檢通過後，輸入 IMPORT 確認
```
腳本流程：
1. 驗證抽取檔 SHA-256 與 `MANIFEST.tsv`。
2. 唯讀預檢：schema 已套用、目前角色擁有 `public.urls`、可繞過 RLS（COPY 進 `auth.users` 需要）、可 INSERT `auth.users/identities`、`on_auth_user_created` 存在、`on_auth_user_copy_email` 不存在、**10 張目標表全為 0 筆**。
3. `psql -v ON_ERROR_STOP=1 --single-transaction` 執行 driver SQL：
   - 交易內再檢查一次目標表為空；
   - `SET session_replication_role = replica`（停用 trigger 與 FK 檢查：`on_auth_user_created` 不會重複建立 `user_profiles`、`url_audit_trigger` 不會多寫稽核紀錄、feedback 計數 trigger 不會重算）；
   - **暫時 DROP `urls_original_url_http_check`**（COPY 仍會檢查 CHECK，那 1 筆 `chrome-extension://` 會被擋）→ 依序 COPY 10 個檔 → 以 `NOT VALID` 加回；
   - 重設 public 序列（目前 0 個）、`REFRESH MATERIALIZED VIEW` 兩個統計 view；
   - 交易內比對 10 張表筆數，任何一張不符即丟例外 → **整個交易 rollback**。
4. COMMIT 後 `ANALYZE`，列出每張表「預期 / 實際 / OK」與其他檢查（非 http(s) 舊資料 1 筆、CHECK 為 NOT VALID、profiles 一對一、RLS 全開、`url_clicks` 0 個 policy、`audit_logs` 0 個 INSERT policy）。

若 Cloud 拒絕 `SET session_replication_role`（Supabase 透過 supautils 允許 postgres 設定此參數，預期不會發生）：交易會整個 rollback，Cloud 不留資料；改走替代方案（`auth.users` 用一般 INSERT 讓 trigger 自動建 profile，`user_profiles` 改 COPY 到暫存表後 UPSERT；public 表由擁有者 `ALTER TABLE ... DISABLE TRIGGER USER` 後再匯入），需另行撰寫，先回報。

## 5. 匯入後檢查

### 5.1 RLS 與統計 RPC（在 SQL editor 或 psql 以 postgres 執行；全程在交易內並 ROLLBACK，不留任何變更；只輸出 PASS/FAIL 與筆數）

```sql
-- post-import-checks（自動挑兩位擁有短網址的使用者 u1/u2，不輸出任何 id 或 email）
BEGIN;
DO $chk$
DECLARE
  u1 uuid; u2 uuid; url1 uuid; n_own bigint; n bigint; v json;
BEGIN
  SELECT created_by INTO u1 FROM public.urls WHERE created_by IS NOT NULL
    GROUP BY created_by ORDER BY count(*) DESC LIMIT 1;
  SELECT created_by INTO u2 FROM public.urls WHERE created_by IS NOT NULL AND created_by <> u1
    GROUP BY created_by ORDER BY count(*) DESC LIMIT 1;
  SELECT count(*) INTO n_own FROM public.urls WHERE created_by = u1;
  SELECT id INTO url1 FROM public.urls WHERE created_by = u1 ORDER BY created_at LIMIT 1;

  -- 以 u1（authenticated）身分
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM public.urls;
  RAISE NOTICE '[RLS] u1 看得到的 urls = %，u1 擁有 = % → %', n, n_own, CASE WHEN n = n_own THEN 'PASS' ELSE 'FAIL' END;
  SELECT count(*) INTO n FROM public.urls WHERE created_by IS DISTINCT FROM u1;
  RAISE NOTICE '[RLS] u1 看得到別人的 urls = % → %', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;
  v := public.get_stats_summary(u1);
  v := public.get_url_stats(url1, 30);
  RAISE NOTICE '[FIX-2] u1 查自己的 get_stats_summary / get_url_stats → PASS';
  SELECT count(*) INTO n FROM public.url_clicks;
  RAISE NOTICE '[FIX-3] authenticated 直接讀 url_clicks = % 筆 → %', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;

  -- 以 u2（authenticated）身分
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO n FROM public.urls WHERE created_by = u1;
  RAISE NOTICE '[RLS] u2 看得到 u1 的 urls = % → %', n, CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END;
  BEGIN v := public.get_url_stats(url1, 30); RAISE NOTICE '[FIX-2] u2 查 u1 的 get_url_stats → FAIL（未被拒）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-2] u2 查 u1 的 get_url_stats → PASS（42501）'; END;
  BEGIN v := public.get_stats_summary(u1); RAISE NOTICE '[FIX-2] u2 查 u1 的 get_stats_summary → FAIL（未被拒）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-2] u2 查 u1 的 get_stats_summary → PASS（42501）'; END;
  BEGIN v := public.get_urls_with_stats(u1, 1, 10); RAISE NOTICE '[FIX-2] u2 查 u1 的 get_urls_with_stats → FAIL（未被拒）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-2] u2 查 u1 的 get_urls_with_stats → PASS（42501）'; END;
  BEGIN v := public.get_daily_stats(u1, 30); RAISE NOTICE '[FIX-2] u2 查 u1 的 get_daily_stats → FAIL（未被拒）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-2] u2 查 u1 的 get_daily_stats → PASS（42501）'; END;
  BEGIN
    INSERT INTO public.urls (short_code, original_url, created_by) VALUES ('zzchk0001', 'javascript:alert(1)', u2);
    RAISE NOTICE '[FIX-1] javascript: 網址 → FAIL（未被擋）';
  EXCEPTION WHEN check_violation THEN RAISE NOTICE '[FIX-1] javascript: 網址 → PASS（23514）'; END;

  -- 以 anon 身分
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  BEGIN SELECT count(*) INTO n FROM public.url_clicks; RAISE NOTICE '[FIX-3] anon 讀 url_clicks → FAIL（可讀）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-3] anon 讀 url_clicks → PASS（42501）'; END;
  BEGIN INSERT INTO public.url_clicks (url_id) VALUES (url1); RAISE NOTICE '[FIX-3] anon 寫 url_clicks → FAIL（可寫）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-3] anon 寫 url_clicks → PASS（42501）'; END;
  BEGIN INSERT INTO public.audit_logs (action) VALUES ('probe'); RAISE NOTICE '[FIX-4] anon 寫 audit_logs → FAIL（可寫）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-4] anon 寫 audit_logs → PASS（42501）'; END;
  BEGIN v := public.get_url_stats(url1, 30); RAISE NOTICE '[FIX-2] anon 呼叫 get_url_stats → FAIL（未被拒）';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE '[FIX-2] anon 呼叫 get_url_stats → PASS（42501）'; END;

  -- 以 service_role JWT（Worker 後端）身分：統計 RPC 必須可用
  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  v := public.get_urls_with_stats(u1, 1, 1000);
  RAISE NOTICE '[FIX-2/5] service_role 呼叫 get_urls_with_stats → PASS（limit 被限制為 %）', v->'pagination'->>'limit';
END
$chk$;
ROLLBACK;
```

預期每一行都是 `PASS`。（此段已在 PGlite 上以實際抽取資料驗證過。）

### 5.2 應用層（Worker 部署後）

1. 用**既有帳號的 email** 以 Google 登入：應連到原本的 user（`/links` 看得到自己原本的短網址數量）。Supabase 會把同一個已驗證 email 的 Google identity 連到既有使用者；84 位使用者的 email 都已驗證。
2. 用**新的 Google 帳號**登入：`user_profiles` 應自動多一筆（`on_auth_user_created` 正常）。若登入出現 "Database error saving new user"，代表 trigger 失敗，先看 Postgres log。
3. `/s/:code` 轉址（含 `?qr=1`、`?g=`）後，統計頁點擊數增加（Worker 以 service role 寫 `url_clicks`）。
4. 統計頁 7 / 30 / 90 天切換正常（`days` 上限 366、`limit` 上限 100 不影響現有前端）。
5. 前端建立 `javascript:` 或其他非 http(s) 網址應失敗（DB CHECK）。
6. 密碼保護連結、廣告頁、意見回饋（含留言數）、管理後台、密語房間照 spec §8 驗收。

## 6. 回復計畫

| 情境 | 處理 |
|---|---|
| 匯入途中任何錯誤（含筆數不符） | 單一交易自動 rollback，Cloud 不留資料。修正原因後重跑 `scripts/import-data.sh`。 |
| 匯入成功但要重來（**尚未正式上線、沒有新使用者**） | 執行下方「清空匯入資料」SQL，再重跑腳本。 |
| schema 本身要重建 | 先清空資料，再執行下方「移除 schema」SQL，改好 migration 後重新套用。 |
| 已上線後發現資料問題 | **不要整批回復**（會刪掉上線後的新資料）；以補丁 SQL 修正。 |
| Cloud 版整體放棄 | 舊自架系統與完整 dump（`pg_dumpall.sql` + `SHA256SUMS`）都未改動，可作為最後依據。 |

清空匯入資料（以 postgres 執行；會連同所有 `auth.users`，包含匯入後才登入的帳號一起刪除）：

```sql
BEGIN;
TRUNCATE public.url_clicks, public.url_channels, public.urls,
         public.feedback_votes, public.feedback_comments, public.feedbacks,
         public.audit_logs, public.user_profiles;
DELETE FROM auth.users;            -- auth.identities / sessions 等以 FK ON DELETE CASCADE 一併刪除
REFRESH MATERIALIZED VIEW public.url_daily_stats;
REFRESH MATERIALIZED VIEW public.url_recent_stats;
COMMIT;
```

移除 schema（先清空資料；`auth.users` 上的 trigger 要先刪）：

```sql
BEGIN;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
DROP MATERIALIZED VIEW IF EXISTS public.url_recent_stats, public.url_daily_stats;
DROP TABLE IF EXISTS public.url_clicks, public.url_channels, public.feedback_votes, public.feedback_comments,
                     public.feedbacks, public.audit_logs, public.urls, public.user_profiles CASCADE;
DROP FUNCTION IF EXISTS public.create_user_profile(), public.sync_user_email(), public.get_current_user_profile(),
  public.get_daily_stats(uuid, integer), public.get_stats_summary(uuid), public.get_url_stats(uuid, integer),
  public.get_urls_with_stats(uuid, integer, integer),
  public.log_audit(character varying, character varying, uuid, jsonb, jsonb, inet, text),
  public.log_url_changes(), public.update_feedback_comment_count(), public.update_feedback_vote_count(),
  public.update_feedbacks_updated_at(), public.update_updated_at_column();
COMMIT;
```
若用 Supabase MCP / CLI 管理 migration，移除後也要把 `supabase_migrations.schema_migrations` 中 `20261102040837`、`20261102044606`、`20261102044647` 這幾筆紀錄一併處理（或用新的 migration 版本重建）。

## 7. 已知事項（未在本次修正）

- `public.log_audit()` 寫入 `audit_logs.ip_address / user_agent`，但線上表沒有這兩欄，函式在線上本來就會失敗；程式未呼叫。已收回 anon/authenticated 的 EXECUTE，保留函式本體。
- `log_url_changes()` 把整列 `to_jsonb(NEW/OLD)`（含 `password_hash`）寫進 `audit_logs`；使用者只能讀自己的日誌，維持原樣。
- 兩個 materialized view 原本由 pg_cron 每分鐘 REFRESH；程式沒有讀取，Cloud 未啟用 pg_cron，故只在匯入時 REFRESH 一次。之後若要用，需啟用 pg_cron 並重建排程。
- feedback 計數 trigger 是 SECURITY INVOKER：使用者在「別人的」意見下留言時，計數更新會被 `feedbacks_update` policy 擋下（維持線上行為）。

## 8. 實際執行紀錄（2026-11-02）

本機沒有 psql，所以實際匯入改用 Supabase Management API（`POST /v1/projects/{ref}/database/query`），工具在 `scripts/supabase-api/`：

- `apply_migration.py <file.sql> <name>`：以 `POST /v1/projects/{ref}/database/migrations` 套用並寫入 migration 紀錄（版本號由 Cloud 以套用時間產生，因此 repo 檔名已改成 Cloud 記錄的版本）。
- `import_via_api.py --dry-run | --run`：把抽取檔的 COPY 文字格式轉成 INSERT，每批約 900 KB、各自 `SET session_replication_role = replica`；匯入前確認目標表皆空，暫時移除 `urls_original_url_http_check`，匯入後以 NOT VALID 加回、重設序列、REFRESH matview、比對筆數、ANALYZE。
- 憑證從 `~/.config/tcurl/supabase.env` 的 `SUPABASE_ACCESS_TOKEN` 讀取（Personal Access Token），不會輸出。

結果：10 張表筆數全部相符（10/10）；§5.1 檢查 15/15 PASS；孤兒資料 0、未驗證 email 0。
之後套用的 migration：`20261102044606_advisor_fixes_and_signup_hook.sql`（advisor 修正 + 註冊網域 hook，hook 已在 Auth 設定啟用）、
`20261102044647_restrict_rpc_to_service_role.sql`（統計 RPC 只允許 service_role 執行）。
