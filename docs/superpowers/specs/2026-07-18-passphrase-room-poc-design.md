# 密語房間 POC — 設計文件

- **日期**：2026-07-18
- **狀態**：設計中（待使用者確認後進實作規劃）
- **範圍**：TCurl（shorturl-api）新增一條免登入、以「密語」分組隔離的實驗性通道
- **主導原則**：POC 取向、YAGNI、不碰現有登入版 App、不動正式 Postgres 資料

---

## 1. 背景與問題

TCurl 目前是**個人化**工具：慈濟員工登入後管理自己的短網址，沒有共享空間概念。

在 POC 測試階段，會有**多人同時測試**。若大家建立的資料全部落在同一個共享池，就**分不清誰是誰、資料互相干擾**。本設計的目的就是解決這個**測試隔離**問題——讓每位測試者有自己的隔離空間，彼此看不到對方。

## 2. 目標與非目標

**目標**
- 免登入即可使用。
- 以「密語」分組：輸入**同一個密語**的人進到**同一個空間**（Wootalk 式）。
- 空間之間**完全隔離**，且**不公開列表**（別人看不到你開了什麼空間）。
- 多人共享狀態，**重整即同步**（非即時 live）。
- 對正式站**零風險**：不動 Postgres、不動現有登入流程，隨時可移除。

**非目標（POC 明確不做）**
- ❌ 即時 live 同步 / 在線名單。
- ❌ 房間統計儀表板、管道/UTM、廣告插頁。
- ❌ 登入閘門（架構保留位置，production 再加）。
- ❌ 動到正式 Postgres schema 或資料。

## 3. 核心概念（密語房間）

1. 使用者開啟房間頁 → 輸入一個**密語**（例：`tzuchi-0718`）。
2. 伺服器把密語**正規化**（去頭尾空白、Unicode NFC、大小寫依實作決定是否折疊）後**做雜湊**，得到 `roomKey`。**原始密語不落地儲存**，只存雜湊。
3. `roomKey` 作為 Deno KV 的 key 前綴——同密語 → 同 `roomKey` → 同一個房間。
4. 想找人一起用：不用傳連結，**告訴對方密語**即可。

> **本質提醒**：密語即鑰匙。若兩人剛好選同一個密語（如 `test`），他們**會**進到同一間——這是密語模式的固有特性，POC 可接受，UI 上以提示文字說明「密語即進場鑰匙，請勿使用過於簡單的字」。

## 4. 架構

### 4.1 儲存：Deno KV

- 使用 Deno 內建 `Deno.openKv()`，**不新增任何服務**（不引入 PocketBase）。
- 資料存於**獨立的 SQLite 檔**（預設路徑或指定路徑），與正式 Postgres **完全隔離**。POC 隨意測試、隨意清除，碰不到正式資料。
- 執行需 `--unstable-kv` 旗標（見 §7 部署註記）。

### 4.2 Key schema

```
["room", roomKey, "meta"]                → { createdAt, itemCount? }   （可選）
["room", roomKey, "item", itemId]        → <一筆記錄>
```

- `roomKey`：密語正規化後的雜湊（hex 字串），確保 key 安全字元且不外洩原始密語。
- `itemId`：`crypto.randomUUID()`（app runtime 可用）。
- 列出某房間全部項目：`kv.list({ prefix: ["room", roomKey, "item"] })` —— **前綴天然隔離**，一個房間只撈得到自己的資料。
- 可選 `expireIn`（例如 7 天）讓 POC 資料自動過期消失。

### 4.3 一筆記錄的內容（**待確認**）

> ⚠️ **唯一的開放決策**：房間內「一筆記錄」代表什麼？機制與上述完全無關，只有這一段的欄位形狀會變。
>
> - **預設（假設）：短網址** —— `{ id, shortCode, originalUrl, title?, createdAt }`。
> - **替代：翻譯結果** —— `{ id, sourceText, translatedText, createdAt }`。
>
> 目前依專案主體先假設為**短網址**。若實際上是翻譯工具，只需替換本節欄位，其餘設計不動。

**短網址記錄的轉址處理（POC 範圍決策）**：現有 `/s/:code` 轉址是讀 Postgres 的。為維持「不碰 Postgres」原則，POC 的房間短網址採**房間範圍內自解析**——即由 rooms 子系統讀 KV 提供預覽/導向，不改動既有 `/s/` 與 Postgres 路徑。功能性全域轉址列為 production 的 fast-follow，不在 POC 內。

### 4.4 API（全新、免登入，掛在 `/api/rooms`）

新增 `src/routes/rooms.ts`，於 `src/main.ts` 掛載，**不套用任何登入中介層**。密語走 HTTP header `X-Room-Pass`，伺服器每個請求當場算 `roomKey`，只操作該房間前綴，無狀態。

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET`    | `/api/rooms/items`      | 列出本房間所有項目（依 `X-Room-Pass` 解析房間） |
| `POST`   | `/api/rooms/items`      | 在本房間新增一筆項目 |
| `PUT`    | `/api/rooms/items/:id`  | 編輯本房間內某項目 |
| `DELETE` | `/api/rooms/items/:id`  | 刪除本房間內某項目 |

- 缺 `X-Room-Pass` 或密語空白 → `400`。
- 所有寫入/讀取一律以 `["room", roomKey, ...]` 前綴限定範圍。
- **不提供任何跨房間或「列出所有房間」的端點。**

### 4.5 前端（乾淨極簡，順帶回應「UI 不好」）

- 新增單頁 `public/room.html`，由 `src/routes/url-pages.ts` 加一條路由 `/r`（或 `/room`）提供。
- 技術棧沿用現有：**Vanilla JS + TailwindCSS**（沿用既有 CDN，避免新增 CSP 來源）。
- 兩個畫面狀態：
  1. **輸入密語**：一個輸入框 + 「進入」按鈕 + 一行提示（密語即鑰匙）。
  2. **房間內**：清爽的項目清單，可新增/編輯/刪除；密語可存在 `sessionStorage` 供本次操作帶入 header（重整需重新輸入或自 sessionStorage 帶回）。
- **全新極簡風格**，不沿用舊版面；**現有登入版頁面原封不動**。

### 4.6 隔離保證（總結）

- 所有讀寫綁 `roomKey` 前綴；無跨房間查詢端點 → 房間之間互不可見。
- `roomKey` 為密語雜湊，不知道密語無法枚舉、無法進入。
- KV 為獨立 SQLite，與正式資料實體隔離。

## 5. 安全考量

- **不落地原始密語**：只存雜湊。
- **傳輸**：密語走 HTTPS header，不放在 URL query（避免出現在 log / referrer）。
- **弱密語共室**：屬密語模式固有特性，UI 提示即可，POC 不強制密語強度。
- **免登入濫用**：POC 明確接受（使用者決策）。production 路線是把 `/api/rooms` 建房動作收斂為「需員工登入」，架構已預留此閘門位置。
- **速率限制**：POC 可先不做；若測試中出現濫用再加最小限流。

## 6. 元件邊界（isolation & clarity）

| 單元 | 職責 | 依賴 |
|------|------|------|
| `src/services/room-store.ts` | 封裝 Deno KV 存取：`enter/list/create/update/remove`，對外只暴露以 `roomKey` 為界的操作 | Deno KV、密語雜湊工具 |
| `src/utils/room-key.ts` | 密語正規化 + 雜湊 → `roomKey` | `@std/crypto` |
| `src/routes/rooms.ts` | HTTP 端點，解析 `X-Room-Pass`、呼叫 room-store | room-store、room-key |
| `public/room.html` | 前端 UI（輸入密語 + 清單 CRUD） | 後端 `/api/rooms/*` |

每個單元可獨立理解與測試；store 不知道 HTTP，route 不知道 KV 細節。

## 7. 部署註記

- **`--unstable-kv` 旗標**：`deno.json` 的 `dev` / `start` task 需加上 `--unstable-kv`；systemd `shorturl-api` 若直接呼叫 deno，也需同步加旗標。`compilerOptions.lib` 已含 `deno.unstable`（型別層），但**執行層仍需該旗標**。
- **權限**：KV 需要 `--allow-read --allow-write`（現有 task 已具備）。
- **版本**：功能完成後於 `deno.json` bump 版本並更新 `public/changelog.json`（依專案慣例）。

## 8. 測試方式

- `src/services/room-store_test.ts`：驗證同密語共享、不同密語隔離、CRUD、`kv.list` 前綴不外洩他房資料。
- `src/utils/room-key_test.ts`：驗證正規化（空白、NFC）→ 同一 `roomKey`；不同密語 → 不同 `roomKey`。
- 手動：兩個瀏覽器輸入同密語看到同資料、不同密語互不可見。

## 9. Production 路線（僅記錄，POC 不做）

1. 把 `/api/rooms` 建房/寫入收斂為「需員工登入」（沿用現有 Supabase JWT 驗證）。
2. 視需要把儲存自 Deno KV 遷移到 Postgres（`room_slug` 欄位或 `rooms` 表）。
3. 若房間短網址要功能性全域轉址，再整合進 `/s/:code` 解析。

## 10. 開放問題

- **記錄型別**：短網址 vs 翻譯結果（見 §4.3）。實作前需最終確認；預設為短網址。
