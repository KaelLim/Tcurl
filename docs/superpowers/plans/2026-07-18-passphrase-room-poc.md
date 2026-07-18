# 密語房間 POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 TCurl 新增一條免登入、以「密語」分組隔離的實驗性通道，讓多人測試時各自的短網址資料互不干擾。

**Architecture:** 密語經正規化 + SHA-256 導出 `roomKey`，作為 Deno KV 的 key 前綴達成房間隔離。全新 `/api/rooms/*`（免登入）+ 單頁 `/r`（Vanilla JS + Tailwind）。資料存於獨立的 Deno KV（SQLite），完全不碰正式 Postgres 與現有登入流程。

**Tech Stack:** Deno 2.x、Hono 4.12（JSR）、Deno KV（`--unstable-kv`）、`@std/crypto`、`@std/encoding`、TailwindCSS CDN。

## Global Constraints

- Runtime：Deno 2.x；Framework：Hono `jsr:@hono/hono@^4.12.23`。
- **Deno KV 執行需 `--unstable-kv` 旗標**（dev / start / test / compile / systemd 皆須）。
- 格式（deno.json fmt）：2-space indent、single quotes、100-char line width。
- Import 路徑一律帶 `.ts` 副檔名（例：`'../services/room-store.ts'`）。
- **不新增任何外部服務**（不引入 PocketBase）；**不動正式 Postgres schema 或資料**；**不修改現有登入版頁面與路由行為**。
- 測試檔命名 `*_test.ts`，置於對應原始碼旁。
- Lint 範圍涵蓋 `src/routes/`、`src/services/`、`src/utils/`——新檔需通過 `deno task lint`。
- 一筆記錄的形狀 = 短網址 `{ id, shortCode, originalUrl, title, createdAt }`（spec §4.3 已拍板；若日後改翻譯，只換此形狀）。
- 每個 commit 訊息結尾加：`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- 分支：`feature/passphrase-room-poc`（已建立）。

---

## File Structure

- `src/utils/room-key.ts`（新增）— 密語正規化 + 導出 `roomKey`。純函式，無 I/O。
- `src/utils/room-key_test.ts`（新增）— room-key 單元測試。
- `src/services/room-store.ts`（新增）— Deno KV 存取封裝（工廠 `createRoomStore(kv)`）。
- `src/services/room-store_test.ts`（新增）— 以 in-memory KV 測試隔離與 CRUD。
- `src/routes/rooms.ts`（新增）— `/api/rooms/*` HTTP 端點（工廠 `createRoomsRouter(store)`）。
- `src/routes/rooms_test.ts`（新增）— 端點測試（Hono `app.request`）。
- `src/routes/url-pages.ts`（修改）— 新增 `/r` 頁面路由。
- `public/room.html`（新增）— 前端單頁 UI。
- `src/main.ts`（修改）— 開啟 KV、掛載 rooms 路由、CORS 允許 `X-Room-Pass`。
- `deno.json`（修改）— 各 task 加 `--unstable-kv`。
- systemd `shorturl-api`（驗證 / 視情況修改）— 確保執行帶 `--unstable-kv`。

---

### Task 1: 密語導出工具（room-key）

**Files:**
- Create: `src/utils/room-key.ts`
- Test: `src/utils/room-key_test.ts`

**Interfaces:**
- Consumes: `@std/crypto`（`crypto.subtle.digest`）、`@std/encoding/hex`（`encodeHex`）。
- Produces:
  - `normalizePassphrase(raw: string): string`
  - `deriveRoomKey(passphrase: string): Promise<string>`（回傳 64 字元 hex）

- [ ] **Step 1: 寫失敗測試**

建立 `src/utils/room-key_test.ts`：

```ts
import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { deriveRoomKey, normalizePassphrase } from './room-key.ts';

Deno.test('normalizePassphrase 去除頭尾空白並做 NFC', () => {
  assertEquals(normalizePassphrase('  hello  '), 'hello');
});

Deno.test('deriveRoomKey 同密語得到同一 key', async () => {
  assertEquals(await deriveRoomKey('tzuchi-0718'), await deriveRoomKey('tzuchi-0718'));
});

Deno.test('deriveRoomKey 空白差異正規化後視為同一房', async () => {
  assertEquals(await deriveRoomKey('tzuchi-0718'), await deriveRoomKey('  tzuchi-0718  '));
});

Deno.test('deriveRoomKey 不同密語得到不同 key', async () => {
  assertNotEquals(await deriveRoomKey('room-a'), await deriveRoomKey('room-b'));
});

Deno.test('deriveRoomKey 產生 64 字元 hex', async () => {
  const k = await deriveRoomKey('x');
  assertEquals(k.length, 64);
  assert(/^[0-9a-f]+$/.test(k));
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/utils/room-key_test.ts`
Expected: FAIL（`Module not found` 或 `deriveRoomKey is not defined`）

- [ ] **Step 3: 實作 room-key.ts**

建立 `src/utils/room-key.ts`：

```ts
/**
 * 密語 → roomKey 導出工具
 *
 * 將使用者輸入的密語正規化後雜湊，作為房間隔離的 key 前綴。
 * 原始密語不落地，只保留雜湊。
 *
 * @module utils/room-key
 */

import { crypto } from '@std/crypto';
import { encodeHex } from '@std/encoding/hex';

/** 命名空間前綴，避免 roomKey 是明文密語的裸 SHA-256 */
const KEY_NAMESPACE = 'tcurl-room:v1:';

/**
 * 正規化密語：去頭尾空白 + Unicode NFC。
 * 區分大小寫（不折疊），行為可預期。
 */
export function normalizePassphrase(raw: string): string {
  return raw.trim().normalize('NFC');
}

/**
 * 由密語導出 roomKey（SHA-256 hex 字串）。
 * 同一密語（正規化後相同）→ 同一 roomKey。
 */
export async function deriveRoomKey(passphrase: string): Promise<string> {
  const normalized = normalizePassphrase(passphrase);
  const data = new TextEncoder().encode(`${KEY_NAMESPACE}${normalized}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return encodeHex(new Uint8Array(digest));
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/utils/room-key_test.ts`
Expected: PASS（5 tests ok）

- [ ] **Step 5: Commit**

```bash
git add src/utils/room-key.ts src/utils/room-key_test.ts
git commit -m "$(cat <<'EOF'
feat(rooms): 新增密語導出工具 room-key

密語正規化 + SHA-256 → roomKey，原始密語不落地。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 房間儲存服務（room-store, Deno KV）

**Files:**
- Create: `src/services/room-store.ts`
- Test: `src/services/room-store_test.ts`

**Interfaces:**
- Consumes: 全域 `crypto`（`randomUUID`、`getRandomValues`）、`Deno.Kv`。
- Produces:
  - `interface RoomItem { id: string; shortCode: string; originalUrl: string; title: string; createdAt: string }`
  - `interface CreateRoomItemInput { originalUrl: string; title?: string }`
  - `interface UpdateRoomItemInput { originalUrl?: string; title?: string }`
  - `createRoomStore(kv: Deno.Kv)` → `{ listItems(roomKey), createItem(roomKey, input), updateItem(roomKey, id, patch), removeItem(roomKey, id) }`
  - `type RoomStore = ReturnType<typeof createRoomStore>`

- [ ] **Step 1: 寫失敗測試**

建立 `src/services/room-store_test.ts`：

```ts
import { assertEquals, assertExists } from '@std/assert';
import { createRoomStore } from './room-store.ts';

async function withStore(fn: (store: ReturnType<typeof createRoomStore>) => Promise<void>) {
  const kv = await Deno.openKv(':memory:');
  try {
    await fn(createRoomStore(kv));
  } finally {
    kv.close();
  }
}

Deno.test('createItem 後 listItems 可取回', async () => {
  await withStore(async (store) => {
    const created = await store.createItem('roomA', {
      originalUrl: 'https://example.com',
      title: 'T',
    });
    assertExists(created.shortCode);
    const items = await store.listItems('roomA');
    assertEquals(items.length, 1);
    assertEquals(items[0].originalUrl, 'https://example.com');
  });
});

Deno.test('不同房間彼此隔離', async () => {
  await withStore(async (store) => {
    await store.createItem('roomA', { originalUrl: 'https://a.com' });
    assertEquals((await store.listItems('roomB')).length, 0);
  });
});

Deno.test('updateItem 修改欄位、保留未變欄位', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com', title: 'old' });
    const updated = await store.updateItem('roomA', it.id, { title: 'new' });
    assertEquals(updated?.title, 'new');
    assertEquals(updated?.originalUrl, 'https://a.com');
  });
});

Deno.test('updateItem 找不到回傳 null', async () => {
  await withStore(async (store) => {
    assertEquals(await store.updateItem('roomA', 'nope', { title: 'x' }), null);
  });
});

Deno.test('removeItem 刪除後 list 為空', async () => {
  await withStore(async (store) => {
    const it = await store.createItem('roomA', { originalUrl: 'https://a.com' });
    assertEquals(await store.removeItem('roomA', it.id), true);
    assertEquals((await store.listItems('roomA')).length, 0);
  });
});

Deno.test('removeItem 找不到回傳 false', async () => {
  await withStore(async (store) => {
    assertEquals(await store.removeItem('roomA', 'nope'), false);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/services/room-store_test.ts`
Expected: FAIL（`Module not found`）

- [ ] **Step 3: 實作 room-store.ts**

建立 `src/services/room-store.ts`：

```ts
/**
 * 密語房間儲存服務（Deno KV）
 *
 * 以 roomKey 為前綴，將每個房間的資料隔離於 Deno KV。
 * 與正式 Postgres 完全無關，資料存於獨立 SQLite。
 *
 * @module services/room-store
 */

const ITEM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天後自動過期
const SHORT_CODE_LEN = 7;
const SHORT_CODE_ALPHABET =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** 房間內一筆記錄（POC：短網址） */
export interface RoomItem {
  id: string;
  shortCode: string;
  originalUrl: string;
  title: string;
  createdAt: string;
}

/** 建立記錄的輸入 */
export interface CreateRoomItemInput {
  originalUrl: string;
  title?: string;
}

/** 編輯記錄的輸入 */
export interface UpdateRoomItemInput {
  originalUrl?: string;
  title?: string;
}

export type RoomStore = ReturnType<typeof createRoomStore>;

function generateShortCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHORT_CODE_LEN));
  let out = '';
  for (const b of bytes) out += SHORT_CODE_ALPHABET[b % SHORT_CODE_ALPHABET.length];
  return out;
}

function itemKey(roomKey: string, id: string): Deno.KvKey {
  return ['room', roomKey, 'item', id];
}

function itemPrefix(roomKey: string): Deno.KvKey {
  return ['room', roomKey, 'item'];
}

/** 以注入的 Deno.Kv 建立房間儲存（方便測試傳入 in-memory KV） */
export function createRoomStore(kv: Deno.Kv) {
  async function listItems(roomKey: string): Promise<RoomItem[]> {
    const items: RoomItem[] = [];
    for await (const entry of kv.list<RoomItem>({ prefix: itemPrefix(roomKey) })) {
      items.push(entry.value);
    }
    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // 新的在前
    return items;
  }

  async function createItem(roomKey: string, input: CreateRoomItemInput): Promise<RoomItem> {
    const item: RoomItem = {
      id: crypto.randomUUID(),
      shortCode: generateShortCode(),
      originalUrl: input.originalUrl,
      title: input.title?.trim() || '',
      createdAt: new Date().toISOString(),
    };
    await kv.set(itemKey(roomKey, item.id), item, { expireIn: ITEM_TTL_MS });
    return item;
  }

  async function updateItem(
    roomKey: string,
    id: string,
    patch: UpdateRoomItemInput,
  ): Promise<RoomItem | null> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key);
    if (!existing.value) return null;
    const updated: RoomItem = {
      ...existing.value,
      originalUrl: patch.originalUrl ?? existing.value.originalUrl,
      title: patch.title !== undefined ? patch.title.trim() : existing.value.title,
    };
    await kv.set(key, updated, { expireIn: ITEM_TTL_MS });
    return updated;
  }

  async function removeItem(roomKey: string, id: string): Promise<boolean> {
    const key = itemKey(roomKey, id);
    const existing = await kv.get<RoomItem>(key);
    if (!existing.value) return false;
    await kv.delete(key);
    return true;
  }

  return { listItems, createItem, updateItem, removeItem };
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/services/room-store_test.ts`
Expected: PASS（6 tests ok）

- [ ] **Step 5: Commit**

```bash
git add src/services/room-store.ts src/services/room-store_test.ts
git commit -m "$(cat <<'EOF'
feat(rooms): 新增 Deno KV 房間儲存服務 room-store

以 roomKey 前綴隔離各房間，提供 list/create/update/remove，
資料存於獨立 KV、7 天自動過期，不碰正式 Postgres。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 房間 API 路由（rooms router）

**Files:**
- Create: `src/routes/rooms.ts`
- Test: `src/routes/rooms_test.ts`

**Interfaces:**
- Consumes: `deriveRoomKey`、`normalizePassphrase`（Task 1）；`validateUrl`（`../utils/url-validator.ts`，回傳 `{ valid, reason? }`）；`RoomStore`（Task 2）；`Hono`。
- Produces: `createRoomsRouter(store: RoomStore): Hono`（掛載完整路徑 `/api/rooms/items`、`/api/rooms/items/:id`）

- [ ] **Step 1: 寫失敗測試**

建立 `src/routes/rooms_test.ts`：

```ts
import { assertEquals } from '@std/assert';
import type { Hono } from '@hono/hono';
import { createRoomStore } from '../services/room-store.ts';
import { createRoomsRouter } from './rooms.ts';

const PASS = 'tzuchi-0718';

async function withApp(fn: (app: Hono) => Promise<void>) {
  const kv = await Deno.openKv(':memory:');
  const app = createRoomsRouter(createRoomStore(kv));
  try {
    await fn(app);
  } finally {
    kv.close();
  }
}

Deno.test('缺少密語回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items');
    assertEquals(res.status, 400);
  });
});

Deno.test('POST 建立項目後 GET 可取回', async () => {
  await withApp(async (app) => {
    const post = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com', title: 'hi' }),
    });
    assertEquals(post.status, 201);
    const get = await app.request('/api/rooms/items', { headers: { 'X-Room-Pass': PASS } });
    const data = await get.json();
    assertEquals(data.items.length, 1);
    assertEquals(data.items[0].title, 'hi');
  });
});

Deno.test('不同密語看不到彼此資料', async () => {
  await withApp(async (app) => {
    await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'https://example.com' }),
    });
    const other = await app.request('/api/rooms/items', {
      headers: { 'X-Room-Pass': 'different' },
    });
    assertEquals((await other.json()).items.length, 0);
  });
});

Deno.test('無效 URL 回傳 400', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Room-Pass': PASS },
      body: JSON.stringify({ originalUrl: 'file:///etc/passwd' }),
    });
    assertEquals(res.status, 400);
  });
});

Deno.test('DELETE 不存在項目回傳 404', async () => {
  await withApp(async (app) => {
    const res = await app.request('/api/rooms/items/nope', {
      method: 'DELETE',
      headers: { 'X-Room-Pass': PASS },
    });
    assertEquals(res.status, 404);
  });
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/routes/rooms_test.ts`
Expected: FAIL（`Module not found`）

- [ ] **Step 3: 實作 rooms.ts**

建立 `src/routes/rooms.ts`：

```ts
/**
 * 密語房間 API 路由（免登入）
 *
 * 密語走 X-Room-Pass header，伺服器當場導出 roomKey，
 * 一切讀寫限定於該房間前綴。無跨房間端點。
 *
 * @module routes/rooms
 */

import { Hono } from '@hono/hono';
import type { Context } from '@hono/hono';
import { deriveRoomKey, normalizePassphrase } from '../utils/room-key.ts';
import { validateUrl } from '../utils/url-validator.ts';
import type { RoomStore } from '../services/room-store.ts';

const MISSING_PASS = { error: '缺少密語（X-Room-Pass）' };

async function resolveRoomKey(c: Context): Promise<string | null> {
  const pass = c.req.header('X-Room-Pass');
  if (!pass || normalizePassphrase(pass).length === 0) return null;
  return await deriveRoomKey(pass);
}

/** 以注入的 store 建立 rooms 路由（方便測試） */
export function createRoomsRouter(store: RoomStore): Hono {
  const app = new Hono();

  app.get('/api/rooms/items', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);
    return c.json({ items: await store.listItems(roomKey) });
  });

  app.post('/api/rooms/items', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);

    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.originalUrl !== 'string') {
      return c.json({ error: '缺少 originalUrl' }, 400);
    }
    const check = validateUrl(body.originalUrl);
    if (!check.valid) return c.json({ error: check.reason }, 400);

    const item = await store.createItem(roomKey, {
      originalUrl: body.originalUrl,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    return c.json({ item }, 201);
  });

  app.put('/api/rooms/items/:id', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);

    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: '請求內容無效' }, 400);
    if (typeof body.originalUrl === 'string') {
      const check = validateUrl(body.originalUrl);
      if (!check.valid) return c.json({ error: check.reason }, 400);
    }
    const updated = await store.updateItem(roomKey, c.req.param('id'), {
      originalUrl: typeof body.originalUrl === 'string' ? body.originalUrl : undefined,
      title: typeof body.title === 'string' ? body.title : undefined,
    });
    if (!updated) return c.json({ error: '找不到項目' }, 404);
    return c.json({ item: updated });
  });

  app.delete('/api/rooms/items/:id', async (c) => {
    const roomKey = await resolveRoomKey(c);
    if (!roomKey) return c.json(MISSING_PASS, 400);
    const ok = await store.removeItem(roomKey, c.req.param('id'));
    if (!ok) return c.json({ error: '找不到項目' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: 執行測試確認通過**

Run: `deno test --unstable-kv --allow-read --allow-write --allow-env src/routes/rooms_test.ts`
Expected: PASS（5 tests ok）

- [ ] **Step 5: Commit**

```bash
git add src/routes/rooms.ts src/routes/rooms_test.ts
git commit -m "$(cat <<'EOF'
feat(rooms): 新增 /api/rooms 免登入路由

密語走 X-Room-Pass header 導出 roomKey；建立時以 validateUrl
擋 SSRF/非法協議；所有讀寫限定房間前綴，無跨房間端點。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 掛載路由與 Deno KV 旗標

**Files:**
- Modify: `src/main.ts`（imports、CORS allowHeaders、掛載 rooms 路由）
- Modify: `deno.json`（各 task 加 `--unstable-kv`）

**Interfaces:**
- Consumes: `createRoomsRouter`（Task 3）、`createRoomStore`（Task 2）。

- [ ] **Step 1: deno.json 各 task 加入 `--unstable-kv`**

修改 `deno.json` 的 `tasks` 區塊為（僅新增 `--unstable-kv`，其餘不變）：

```json
  "tasks": {
    "dev": "deno run --watch --env --unstable-kv --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts",
    "start": "deno run --env --unstable-kv --allow-net --allow-read --allow-write --allow-env --allow-run src/main.ts",
    "test": "deno test --unstable-kv --allow-net --allow-read --allow-write --allow-env",
    "lint": "deno lint",
    "fmt": "deno fmt",
    "check": "deno check src/main.ts",
    "compile": "deno compile --unstable-kv --allow-net --allow-read --allow-write --allow-env --output=tcurl src/main.ts",
    "cache": "deno cache src/main.ts",
    "deploy": "deno task cache && deno task check && deno task start"
  },
```

- [ ] **Step 2: main.ts 新增 import**

在 `src/main.ts` 既有路由 import 區塊（`import { adminRoutes } from './routes/admin.ts';` 之後）加入：

```ts
import { createRoomsRouter } from './routes/rooms.ts';
import { createRoomStore } from './services/room-store.ts';
```

- [ ] **Step 3: main.ts CORS allowHeaders 加入 `X-Room-Pass`**

將 `src/main.ts` 中 CORS 的 `allowHeaders` 由：

```ts
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
```

改為：

```ts
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Room-Pass'],
```

- [ ] **Step 4: main.ts 掛載 rooms 路由**

在 `src/main.ts` 的 `app.route('/', adminRoutes);` 之後、`// MIME type 對照表` 之前，加入：

```ts
// 註冊密語房間路由（POC，免登入，Deno KV）
const roomKv = await Deno.openKv();
app.route('/', createRoomsRouter(createRoomStore(roomKv)));
```

- [ ] **Step 5: 型別檢查與 lint**

Run: `deno task check && deno task lint`
Expected: 兩者皆無錯誤（`Checked N files` / lint 0 problems）

- [ ] **Step 6: 全套測試通過**

Run: `deno task test`
Expected: PASS（含 Task 1–3 共 16 tests，且原有測試不受影響）

- [ ] **Step 7: Commit**

```bash
git add src/main.ts deno.json
git commit -m "$(cat <<'EOF'
feat(rooms): 掛載 /api/rooms 路由並啟用 Deno KV

main.ts 開啟 KV 並注入 rooms router；CORS 允許 X-Room-Pass；
deno.json 各 task 加 --unstable-kv。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 前端頁面（room.html + /r 路由）

**Files:**
- Create: `public/room.html`
- Modify: `src/routes/url-pages.ts`（新增 `/r` 路由）

**Interfaces:**
- Consumes: `/api/rooms/items`（Task 3）、`serveHtml`（url-pages.ts 既有 helper）。

- [ ] **Step 1: 新增 /r 頁面路由**

在 `src/routes/url-pages.ts` 末尾（`urlPageRoutes.get('/admin', ...)` 之後）加入：

```ts
urlPageRoutes.get('/r', (c) => serveHtml(c, './public/room.html'));
```

- [ ] **Step 2: 建立 public/room.html**

建立 `public/room.html`（Vanilla JS + Tailwind CDN；inline script 受 CSP `'unsafe-inline'` 允許；fetch 為同源）：

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>密語房間 · TCurl</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-50 text-slate-800 min-h-screen">
  <div class="max-w-2xl mx-auto px-4 py-10">
    <!-- 進入密語 -->
    <section id="enter-view" class="hidden">
      <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <h1 class="text-2xl font-semibold mb-2">密語房間</h1>
        <p class="text-sm text-slate-500 mb-6">
          輸入相同密語的人會進到同一個空間。密語即進場鑰匙，請勿使用過於簡單的字。
        </p>
        <form id="enter-form" class="flex gap-2">
          <input id="passphrase-input" type="text" autocomplete="off"
            class="flex-1 rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="輸入密語，例如 tzuchi-0718" />
          <button type="submit"
            class="rounded-lg bg-indigo-600 text-white px-5 py-2 font-medium hover:bg-indigo-700">進入</button>
        </form>
      </div>
    </section>

    <!-- 房間內 -->
    <section id="room-view" class="hidden">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl font-semibold">房間</h1>
          <p class="text-sm text-slate-500">密語：<span id="room-name" class="font-mono"></span></p>
        </div>
        <button id="leave-btn" class="text-sm text-slate-500 hover:text-slate-800">離開</button>
      </div>

      <form id="add-form" class="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6 space-y-3">
        <input id="url-input" type="url" required
          class="w-full rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          placeholder="目標網址 https://..." />
        <div class="flex gap-2">
          <input id="title-input" type="text"
            class="flex-1 rounded-lg border border-slate-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="標題（可選）" />
          <button type="submit"
            class="rounded-lg bg-indigo-600 text-white px-5 py-2 font-medium hover:bg-indigo-700">新增</button>
        </div>
      </form>

      <div id="error-box"
        class="hidden mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2"></div>

      <ul id="item-list" class="space-y-3"></ul>
      <p id="empty-hint" class="hidden text-center text-slate-400 py-10">還沒有任何項目，從上面新增一個吧。</p>
    </section>
  </div>

  <script>
    const API = '/api/rooms/items';
    let passphrase = sessionStorage.getItem('roomPass') || '';
    let currentItems = [];

    const enterView = document.getElementById('enter-view');
    const roomView = document.getElementById('room-view');
    const errorBox = document.getElementById('error-box');

    function headers() {
      return { 'Content-Type': 'application/json', 'X-Room-Pass': passphrase };
    }
    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
      setTimeout(() => errorBox.classList.add('hidden'), 4000);
    }
    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function render(items) {
      currentItems = items;
      const list = document.getElementById('item-list');
      const empty = document.getElementById('empty-hint');
      list.innerHTML = '';
      empty.classList.toggle('hidden', items.length > 0);
      for (const it of items) {
        const li = document.createElement('li');
        li.className =
          'bg-white rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-3';
        li.innerHTML =
          '<div class="min-w-0">' +
            '<p class="font-medium truncate">' + esc(it.title || it.shortCode) + '</p>' +
            '<p class="text-xs text-slate-400 font-mono">/' + esc(it.shortCode) + '</p>' +
            '<a href="' + esc(it.originalUrl) + '" target="_blank" rel="noopener" ' +
              'class="text-sm text-indigo-600 hover:underline break-all">' + esc(it.originalUrl) + '</a>' +
          '</div>' +
          '<div class="flex flex-col gap-1 shrink-0 text-sm">' +
            '<button data-id="' + esc(it.id) + '" class="edit-btn text-slate-400 hover:text-indigo-600">編輯</button>' +
            '<button data-id="' + esc(it.id) + '" class="del-btn text-slate-400 hover:text-red-600">刪除</button>' +
          '</div>';
        list.appendChild(li);
      }
      list.querySelectorAll('.del-btn').forEach((b) =>
        b.addEventListener('click', () => removeItem(b.dataset.id)));
      list.querySelectorAll('.edit-btn').forEach((b) =>
        b.addEventListener('click', () => editItem(b.dataset.id)));
    }

    async function load() {
      const res = await fetch(API, { headers: headers(), cache: 'no-store' });
      if (!res.ok) { showError('載入失敗'); return; }
      render((await res.json()).items || []);
    }

    async function addItem(originalUrl, title) {
      const res = await fetch(API, {
        method: 'POST', headers: headers(), body: JSON.stringify({ originalUrl, title }),
      });
      if (!res.ok) { showError((await res.json().catch(() => ({}))).error || '新增失敗'); return; }
      await load();
    }

    async function editItem(id) {
      const cur = currentItems.find((x) => x.id === id);
      if (!cur) return;
      const title = prompt('標題', cur.title || '');
      if (title === null) return;
      const originalUrl = prompt('目標網址', cur.originalUrl);
      if (originalUrl === null) return;
      const res = await fetch(API + '/' + id, {
        method: 'PUT', headers: headers(), body: JSON.stringify({ title, originalUrl }),
      });
      if (!res.ok) { showError((await res.json().catch(() => ({}))).error || '更新失敗'); return; }
      await load();
    }

    async function removeItem(id) {
      const res = await fetch(API + '/' + id, { method: 'DELETE', headers: headers() });
      if (!res.ok) { showError('刪除失敗'); return; }
      await load();
    }

    function enterRoom(pass) {
      passphrase = pass;
      sessionStorage.setItem('roomPass', pass);
      document.getElementById('room-name').textContent = pass;
      enterView.classList.add('hidden');
      roomView.classList.remove('hidden');
      load();
    }

    function leaveRoom() {
      passphrase = '';
      sessionStorage.removeItem('roomPass');
      roomView.classList.add('hidden');
      enterView.classList.remove('hidden');
      document.getElementById('passphrase-input').value = '';
    }

    document.getElementById('enter-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = document.getElementById('passphrase-input').value.trim();
      if (val) enterRoom(val);
    });
    document.getElementById('add-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('url-input').value.trim();
      const title = document.getElementById('title-input').value.trim();
      if (url) { addItem(url, title); e.target.reset(); }
    });
    document.getElementById('leave-btn').addEventListener('click', leaveRoom);

    if (passphrase) enterRoom(passphrase);
    else enterView.classList.remove('hidden');
  </script>
</body>
</html>
```

- [ ] **Step 3: 手動驗證頁面**

啟動：`deno task start`（背景或另一終端），然後：

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/r`
Expected: `200`

瀏覽器開兩個分頁到 `http://localhost:3000/r`，兩邊輸入**同一密語** → 一邊新增、另一邊重整看得到；換**不同密語** → 看不到對方項目。

- [ ] **Step 4: Commit**

```bash
git add public/room.html src/routes/url-pages.ts
git commit -m "$(cat <<'EOF'
feat(rooms): 新增密語房間前端頁面 /r

極簡 Tailwind 單頁：輸入密語進房、清單新增/編輯/刪除，
密語存 sessionStorage 帶入 X-Room-Pass；不沿用舊版面。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 部署旗標驗證、版本與變更日誌

**Files:**
- Verify/Modify: systemd `shorturl-api` 服務定義
- Modify: `deno.json`（version）、`public/changelog.json`

**Interfaces:** 無新程式介面。

- [ ] **Step 1: 確認 systemd 執行帶 `--unstable-kv`**

Run: `systemctl cat shorturl-api | grep -i ExecStart`
- 若 `ExecStart` 呼叫 `deno task start` → 已由 Task 4 的 deno.json 覆蓋，**無需改動**。
- 若 `ExecStart` 直接呼叫 `deno run ...`（未經 task）→ 編輯該 unit 檔，在 `deno run` 後加入 `--unstable-kv`，然後 `sudo systemctl daemon-reload`。

- [ ] **Step 2: bump 版本**

將 `deno.json` 的 `"version": "1.4.0"` 改為 `"version": "1.5.0"`。

- [ ] **Step 3: 新增 changelog 項目**

在 `public/changelog.json` 陣列**最前面**插入：

```json
  {
    "version": "1.5.0",
    "date": "2026-07-18",
    "title": "密語房間（實驗性 POC）",
    "changes": [
      { "type": "feat", "text": "新增「密語房間」：輸入相同密語即進到同一個隔離空間，免登入、多人共用（重整同步）" },
      { "type": "feat", "text": "房間資料存於獨立 Deno KV，7 天自動過期，與正式資料完全隔離" }
    ]
  },
```

- [ ] **Step 4: 最終全套測試 + 型別 + lint**

Run: `deno task check && deno task lint && deno task test`
Expected: 三者皆通過。

- [ ] **Step 5: Commit**

```bash
git add deno.json public/changelog.json
git commit -m "$(cat <<'EOF'
chore(rooms): bump 版本至 1.5.0 並更新 changelog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage**（對照 `2026-07-18-passphrase-room-poc-design.md`）：
- §3 密語機制 / §4.2 key schema → Task 1（roomKey）+ Task 2（KV 前綴）。✅
- §4.1 Deno KV、獨立儲存 → Task 2 + Task 4（`--unstable-kv`）。✅
- §4.3 記錄形狀（短網址）→ Task 2 `RoomItem`。✅
- §4.4 API（GET/POST/PUT/DELETE、X-Room-Pass、缺密語 400）→ Task 3。✅
- §4.5 前端頁 `/r`、極簡、CRUD、sessionStorage → Task 5。✅
- §4.6 隔離保證（前綴、無跨房間端點）→ Task 2/3 測試涵蓋。✅
- §5 安全（不落地原始密語、validateUrl 擋 SSRF）→ Task 1 雜湊、Task 3 validateUrl。✅
- §6 元件邊界（room-key / room-store / rooms / room.html）→ Task 1/2/3/5。✅
- §7 部署（`--unstable-kv`、版本/changelog）→ Task 4/6。✅
- §8 測試 → Task 1/2/3 皆含 `*_test.ts`。✅
- §9 production 路線、§10 開放問題 → 明確 out-of-scope，Global Constraints 已記錄記錄形狀來源。✅

**2. Placeholder scan：** 無 TBD/TODO；每個程式步驟都有完整程式碼與確切指令。✅

**3. Type consistency：** `roomKey: string`、`RoomItem`、`CreateRoomItemInput`、`UpdateRoomItemInput`、`RoomStore`、`createRoomStore`、`createRoomsRouter` 在 Task 2/3/4 一致；端點路徑 `/api/rooms/items(/:id)` 與前端 `API = '/api/rooms/items'` 一致；header `X-Room-Pass` 三處一致。✅
