# 服務 API 金鑰設計

- 日期：2026-11-03
- 狀態：已核准（2026-11-03）
- 範圍：TCurl（`tcurl-workers`，Cloudflare Workers + Hono + Supabase Cloud）

標記說明：**【使用者決定】** 是使用者在討論中明確決定的事；**【設計判斷】** 是設計者代為決定、使用者可推翻的事；未標記的是由現有系統或前兩者推導出來的。

## 1. 目的與背景

TCurl 目前只有慈濟同仁用 Google 帳號（限 @tzuchi.org.tw）登入後使用。內部其他網站服務也要呼叫 TCurl API，例如自動產生短網址。這些服務不是人，沒辦法走 Google OAuth，需要一種**由 TCurl 發放、可長期使用的金鑰**。

內部服務要拿短網址做什麼，由同仁自己討論，**不在本設計範圍**。本設計只負責：讓獲得授權的服務，用金鑰安全地呼叫 TCurl API。

## 2. 目標

1. 管理者可以替某個內部服務產生一把 API 金鑰，交給對方使用。【使用者決定】
2. 每把金鑰要指定一位**負責同仁**，第一把是 `kael1996@tzuchi.org.tw`。金鑰建立的短網址歸負責同仁所有，會出現在他的「我的連結」裡，可在網頁上管理。【使用者決定】
3. 金鑰只能管理**自己建立的短網址**，碰不到負責同仁在網頁上手動建立的短網址、別把金鑰的短網址，也碰不到管理者功能。【使用者決定】
4. 管理者可以隨時撤銷金鑰，立即生效；可以設到期日；可以把金鑰轉給另一位負責同仁。
5. 一般同仁用網頁、Google 登入的既有行為完全不變。

## 3. 非目標

- **roles 表**（在資料庫裡維護誰是管理者）：使用者說「未來可能需要」，這次不做。管理者仍由 `ADMIN_EMAILS` 判定，但判斷要集中在同一個函式，之後換成 roles 表時，金鑰功能不必改。【設計判斷】
- 同仁自己申請或產生金鑰。只有管理者能發。【使用者決定】
- OAuth client credentials（先換短效 token 再呼叫）、HMAC 請求簽章。
- IP 白名單、每把金鑰各自設定限流上限、webhook、金鑰使用量報表（只記最後使用時間）。
- 自動輪替金鑰。需要換金鑰時，管理者發一把新的、撤銷舊的。

## 4. 反目標（做出來但這樣就算失敗）

- 一把金鑰外洩後，能讀取或修改它自己建立的短網址以外的任何資料。
- 金鑰可以用在管理者 API、`/api/auth/*`、社群建議等不該開放的端點。
- 資料庫、記錄檔或任何回應中，出現完整金鑰（產生當下那一次回應除外）。
- 一般同仁的登入、RLS 權限、轉址行為被改變。

## 5. 限制

- **無法用 RLS 保護金鑰請求。** Supabase Cloud 專案用 ES256（非對稱）簽發 JWT，私鑰在 Supabase 端，Worker 無法替金鑰簽發 Supabase 使用者 JWT。所以金鑰請求必須用 service role client（會繞過 RLS），**授權完全靠 Worker 程式碼明確限定範圍**（見 §6.4）。這是本設計風險最高的地方，測試要逐一覆蓋。
- 統計相關的 RPC（`get_urls_with_stats`、`get_url_stats`、`get_stats_summary`、`get_daily_stats`）已限定只有 `service_role` 能執行，後端本來就用 service client 加上 `p_user_id` 呼叫。
- 資料庫變更要寫成 `supabase/migrations/` 的 migration 檔。Supabase PAT 已撤銷，套用 migration 改用已連線的 Supabase MCP（`apply_migration`），套用前先徵得使用者同意。
- 沿用現有慣例：Hono、`c.env`、Vitest 測試（`tests/helpers/test-env.ts` 的替身）、版本號加 changelog、`cf deploy`。

## 6. 設計

### 6.1 金鑰格式與保存

- 格式：`tcurl_sk_` 加 32 bytes 密碼學亂數（base64url，約 43 字元）。固定開頭方便辨識、方便搜尋有沒有外洩。【設計判斷】
- 資料庫只存 **SHA-256 雜湊**（hex），加上用來顯示的開頭幾碼（例如 `tcurl_sk_Ab12…`）。金鑰本身熵值夠高，不需要 bcrypt 或加鹽。
- 完整金鑰**只在建立當下的 API 回應出現一次**。之後任何 API、後台頁面、記錄都拿不到。
- 驗證：計算請求中金鑰的雜湊，依雜湊查表。

### 6.2 資料模型

新增資料表 `public.api_keys`（欄位名稱可由實作者微調）：

| 欄位 | 說明 |
|---|---|
| `id` uuid PK | |
| `name` text not null | 服務名稱，例如「某某報名系統」 |
| `key_prefix` text not null | 顯示用的開頭幾碼 |
| `key_hash` text not null unique | SHA-256 hex |
| `owner_id` uuid null → `auth.users`（`ON DELETE SET NULL`） | 負責同仁；帳號被刪除時變成 null，金鑰隨即失效（見 §6.2.1） |
| `scopes` text[] not null | `read`、`write`（見 §6.3） |
| `expires_at` timestamptz null | null 代表不過期 |
| `created_by` uuid → `auth.users` | 發放的管理者 |
| `created_at` timestamptz default now() | |
| `revoked_at` timestamptz null、`revoked_by` uuid null | 撤銷資訊 |
| `last_used_at` timestamptz null | 最後使用時間 |

- 開啟 RLS，**不給 anon / authenticated 任何 policy**：只有 service role（Worker）能讀寫。前端不會直接查這張表。
- `public.urls` 新增 `api_key_id uuid null → api_keys(id)`，加索引。網頁建立的短網址為 null。
- 新增 trigger 保護 `urls.api_key_id`（見 §6.2.2）。
- 金鑰撤銷**不刪除資料列**（保留稽核紀錄），只設 `revoked_at`。它建立的短網址繼續存在、繼續轉址，負責同仁照樣可以在網頁上管理。

#### 6.2.1 負責同仁離職、被刪除或被停權【設計判斷】

- TCurl 無法得知同仁何時離職（Google 帳號停用不會通知 TCurl），所以**由管理者負責**：同仁離職時，把他名下的金鑰轉給接手的同仁（§6.6）。
- 系統會自動處理的情況：
  - **帳號被刪除**：`owner_id` 變成 null，金鑰失效。金鑰資料列與短網址的 `api_key_id` 都保留。這些短網址的 `created_by` 會照現有外鍵變成 null。
  - **帳號被停權**（Supabase `banned_until` 晚於現在）：金鑰驗證失敗。
- 後台金鑰列表顯示負責同仁的狀態（正常、已刪除、已停權，以及最後登入時間），方便管理者發現該轉移的金鑰。
- **轉移**時，移動的短網址是 `api_key_id` 等於這把金鑰，**且** `created_by` 等於原負責人**或為 null** 的那些。這樣帳號被刪除後的短網址也救得回來。轉給有效的同仁後，金鑰恢復可用；已撤銷的金鑰也可以轉移，但仍維持撤銷。

#### 6.2.2 一般使用者不能自己設定 `api_key_id`【設計判斷】

- 網頁版有部分操作直接透過 Supabase 寫 `urls`，RLS 只檢查 `created_by`。如果不擋，同仁可以把自己手動建立的短網址標上某把金鑰的 id，讓那把金鑰碰得到它。這違反目標 3，也會讓別的服務名稱出現在他的短網址旁、灌水管理者看到的數量。
- 做法：在 `urls` 加 `BEFORE INSERT OR UPDATE` trigger。呼叫者不是 `service_role` 時：
  - 新增：`api_key_id` 必須是 null。
  - 修改：不得變更 `api_key_id`。
  - 違反時拋錯。
- 一般同仁本來就不會設定這個欄位，所以網頁的正常操作完全不受影響。§6.4 的「同時限定兩個條件」保留，作為第二道防線。

### 6.3 權限範圍（scopes）

每把金鑰可以有 `read`、`write` 其中之一或兩者，預設兩者都有。【設計判斷】

| 端點 | 需要的權限 | 金鑰請求的行為 |
|---|---|---|
| `GET /api/urls` | read | 只列出這把金鑰建立的短網址（含統計） |
| `GET /api/urls/:id` | read | 只限這把金鑰的短網址，否則 404 |
| `GET /api/urls/:id/stats` | read | 同上 |
| `GET /api/urls/stats/summary`、`GET /api/stats/daily` | read | 只計算這把金鑰的短網址 |
| `GET /api/urls/:id/channels` | read | 只限這把金鑰的短網址 |
| `POST /api/urls` | write | 建立短網址：`created_by` = 負責同仁、`api_key_id` = 這把金鑰 |
| `PUT /api/urls/:id`、`PATCH /api/urls/:id/qr-code`、`DELETE /api/urls/:id` | write | 只限這把金鑰的短網址，否則 404；照樣清轉址快取 |
| `POST/PUT/DELETE /api/urls/:id/channels…` | write | 只限這把金鑰的短網址 |
| `/api/admin/*`、`/api/auth/*`、`/api/feedbacks*` | — | 一律拒絕（401） |
| 轉址、廣告頁、密碼驗證、密語房間 | — | 本來就不需登入，不受影響 |

- 權限不足回 **403**。查不到，或短網址不屬於這把金鑰，回 **404**（不透露短網址是否存在）。
- 這張表以外的新端點**預設拒絕金鑰**。要開放必須明確加入，避免日後新增端點時不小心開放。

### 6.4 請求驗證與授權

- 請求帶 `Authorization: Bearer <token>`。開頭是 `tcurl_sk_` 就走金鑰驗證，否則照舊當作 Supabase JWT 處理，現有流程不變。
- 金鑰驗證成功的條件：雜湊存在、未撤銷、未過期、負責同仁存在且未被停權。任一條件不成立都回 **401**，訊息不區分原因（例如一律「API 金鑰無效或已失效」），但伺服器記錄要能分辨原因。
- 驗證後，請求得到一個「呼叫者」物件，例如 `{ kind: 'api_key', keyId, ownerId, scopes }` 或 `{ kind: 'user', … }`。各路由依呼叫者種類決定怎麼存取資料：
  - **使用者**：維持現在的 user client 加 RLS。
  - **金鑰**：用 service client，所有對 `urls` 的查詢與修改都**同時限定** `created_by = ownerId` **且** `api_key_id = keyId`。channels 和統計先確認所屬短網址符合這兩個條件。
- 兩個條件都要限定，作為 §6.2.2 trigger 之外的第二道防線：就算 `api_key_id` 被錯誤設定，只要負責人不同，金鑰也碰不到。
- 統計 RPC 加一個可選參數（例如 `p_api_key_id uuid default null`）。不為 null 時只計算該金鑰的短網址。網頁呼叫不傳，行為不變。【設計判斷】
- 驗證查詢**不快取**，每次都查資料庫，確保撤銷立即生效。內部服務的呼叫量低，多一次查詢可以接受。【設計判斷】
- `last_used_at` 在背景（`waitUntil`）更新，同一把金鑰最多每分鐘寫一次。

### 6.5 限流

- 帶有效金鑰的請求，改用**每把金鑰各自的限流**：新增 Rate Limiting binding，每把金鑰每 60 秒 300 次，【設計判斷】可調。不吃一般的 IP 限流，因為多個內部服務可能共用同一個對外 IP。
- 帶無效金鑰的請求回 401，並照樣計入 IP 限流，避免有人用亂造的金鑰繞過 IP 限流、灌爆資料庫查詢。
- 中介層的執行順序由實作者決定，但要滿足以上兩點。

### 6.6 管理者 API 與後台

管理者判斷沿用 `admin.ts` 的 `getAdminUser`（`ADMIN_EMAILS`）。這是唯一的判斷點，之後換成 roles 表只改這裡。金鑰本身不能呼叫以下 API。

- `GET /api/admin/api-keys`：列出所有金鑰，不含雜湊或完整金鑰。欄位：名稱、開頭幾碼、負責同仁 email、權限、發放者、建立時間、到期日、最後使用時間、狀態（有效、已撤銷、已過期）、建立的短網址數。
- `POST /api/admin/api-keys`：輸入名稱、負責同仁 email、權限、到期日。負責同仁必須是已存在的帳號，也就是至少登入過一次的 @tzuchi.org.tw 帳號，否則回 400。回應**唯一一次**包含完整金鑰。
- `POST /api/admin/api-keys/:id/revoke`：撤銷，立即生效。
- `PUT /api/admin/api-keys/:id`：改名稱、改到期日、轉移負責同仁。轉移時，`api_keys.owner_id` 和這把金鑰建立的所有短網址的 `created_by` 要**在同一個交易內**一起改。可用 service-role-only 的 RPC 完成。

後台 `admin.html` 新增「API 金鑰」分頁：
- 金鑰列表。
- 「發放金鑰」表單。到期日選項：90 天、1 年、不過期，預設 1 年。【設計判斷】
- 發放成功後的對話框：顯示完整金鑰、複製按鈕，並註明「關閉後就無法再看到，請立即交給對方」。
- 撤銷要二次確認。
- 轉移負責同仁。

### 6.7 負責同仁的體驗

- 金鑰建立的短網址出現在負責同仁的「我的連結」，可以照常編輯、停用、刪除、看統計。這些操作走網頁，受 RLS 保護，不受影響。
- 列表和編輯頁標示「由 API：〈服務名稱〉建立」。`get_urls_with_stats` 的回傳要帶出金鑰名稱。
- 金鑰撤銷後，短網址仍屬於負責同仁，標示可以改成「由 API：〈服務名稱〉（已撤銷）建立」。

### 6.8 記錄與稽核【設計判斷】

原則：跟安全有關、量又少的事件，永久存在資料庫；量大、價值低的只寫 Worker 記錄。

- **永久存在資料庫**（`public.audit_logs`，新增可為 null 的 `api_key_id` 欄位）：
  - **金鑰的發放、撤銷、轉移**：`user_id` 是執行的管理者，`resource_type = 'api_key'`。轉移時 `old_values` / `new_values` 記前後的負責同仁，這樣 `owner_id` 被覆寫後仍查得到歷史。
  - **用金鑰建立、修改、刪除短網址**：現有的 `url_audit_trigger`（`log_url_changes`）會把變更寫進 `audit_logs`，但它用 `auth.uid()` 記操作者，金鑰請求走 service role 時會是 null。要讓這些紀錄也帶上 `api_key_id`。
  - 做法建議：Worker 處理金鑰請求時，在 service client 上帶一個自訂標頭（例如 `x-tcurl-api-key-id`）。trigger 從 PostgREST 的 `request.headers` 讀取，**只有呼叫者是 `service_role` 時才採信**，避免一般使用者自己帶這個標頭冒充。確切機制由實作者決定，但要有測試或實際驗證。
- **只寫 Worker 記錄**：金鑰驗證失敗（記雜湊的開頭幾碼與失敗原因，不記原文）、每次 API 呼叫是哪把金鑰（現有稽核中介層加上 `api_key_id`）。
- 確認任何記錄（`logger()`、稽核、錯誤記錄）都不會印出 `Authorization` 標頭或完整金鑰。

### 6.9 給對方服務的說明

- 更新 `public/docs/openapi.yaml`：新增 API 金鑰的驗證方式，並標明哪些端點接受金鑰、需要哪個權限。
- 對方的呼叫方式：`curl -H "Authorization: Bearer tcurl_sk_…" https://url.tzuchi.org/api/urls`。

## 7. 留給實作者決定

- 資料表、欄位、RPC 參數的確切名稱，以及 migration 怎麼切分。
- 呼叫者物件的形狀，以及各路由怎麼共用「依呼叫者存取資料」的邏輯。可以抽一層，也可以在各路由內分支，只要 §6.3、§6.4 的規則都有測試覆蓋。
- 後台分頁的版面，沿用 admin.html 現有的樣式與元件。
- 負責同仁帳號被刪除時，用什麼機制讓金鑰失效。
- 新限流 binding 的 namespace 編號。

## 8. 測試重點（至少要涵蓋）

1. 金鑰可以建立短網址，`created_by` 是負責同仁、`api_key_id` 是這把金鑰。
2. 金鑰讀不到也改不到：負責同仁手動建立的短網址、別把金鑰的短網址、別人的短網址，回 404。列表和統計也不會包含它們。
3. 撤銷、過期、不存在的金鑰，以及負責同仁已不存在的金鑰，都回 401；撤銷後下一個請求就失效。
4. 只有 `read` 的金鑰呼叫寫入端點回 403。
5. 金鑰呼叫 `/api/admin/*`、`/api/auth/*`、`/api/feedbacks*` 被拒。
6. 資料庫只存雜湊。建立 API 之外的任何回應都不含完整金鑰。
7. 每把金鑰各自限流；無效金鑰計入 IP 限流。
8. 金鑰修改或刪除短網址時，轉址快取照樣被清除。
9. 轉移負責同仁後，金鑰建立的短網址整批移到新負責人名下，舊負責人看不到。負責同仁帳號被刪除後，轉移仍救得回那些短網址，金鑰也恢復可用。
10. 負責同仁被停權時，金鑰驗證失敗。
11. 一般使用者透過 Supabase 直接新增或修改 `urls` 時，無法設定或變更 `api_key_id`；不動這個欄位的正常操作照樣成功。
12. 發放、撤銷、轉移金鑰，以及用金鑰改短網址，都在 `audit_logs` 留下帶 `api_key_id` 的紀錄；一般使用者無法靠自訂標頭寫入 `api_key_id`。
13. 一般使用者（JWT）的既有測試全部照樣通過。

## 9. 上線步驟

1. 套用 migration（Supabase MCP，先徵得使用者同意）。
2. 部署 Worker，版本升為 1.7.0，加 changelog。
3. 管理者在後台替第一個服務發放金鑰，負責同仁是 `kael1996@tzuchi.org.tw`。
4. 用這把金鑰實測：建立、列出、改、看統計、刪除短網址；確認讀不到負責同仁手動建立的短網址；撤銷後確認失效。測試用的短網址和點擊用完刪除。
5. 確認無誤後，把金鑰和 API 文件網址交給對方服務。
