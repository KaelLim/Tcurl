/**
 * 服務 API 金鑰：管道路由（src/routes/url-channels.ts；spec §6.3、§6.4）
 *
 * - 金鑰請求「確認 URL 屬於呼叫者」改用 getSupabaseForApiKey（service role，帶 x-tcurl-api-key-id）
 *   + scopeToApiKey 查 urls：同時限定 created_by = 負責同仁、api_key_id = 這把金鑰；不把金鑰當 JWT
 *   送到 Supabase
 * - 不屬於這把金鑰（m／b／x，含非 UUID 的 :id）→ 404，且 url_channels、url_clicks 都沒被讀寫
 * - 其餘既有邏輯不變：管道上限、group_key、PUT/DELETE 清管道轉址快取
 *
 * 假資料庫依 query string 篩選，service role 看得到所有資料列（同真實的 RLS 繞過），所以金鑰分支
 * 少帶任何一個條件，m／b／x 的管道就會被讀到或改到。
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Bindings } from '../src/types/env.ts';
import {
  createTestEnv,
  jsonResponse,
  mockSupabaseFetch,
  pgrstNotFound,
  workerRequest,
  type SupabaseCall,
} from './helpers/test-env.ts';

const KEY = 'tcurl_sk_Zx9Qw3Er5Ty7Ui1Op0As2Df4Gh6Jk8LzXcVbNm-_Q1w';
/** 這把金鑰 */
const K = '11111111-1111-4111-8111-111111111111';
/** 同一位負責同仁的另一把金鑰 */
const K2 = '55555555-5555-4555-8555-555555555555';
/** 負責同仁 */
const U = '22222222-2222-4222-8222-222222222222';
/** 另一位使用者 */
const O = '33333333-3333-4333-8333-333333333333';
const USER_JWT = 'user-jwt';

const SERVICE_ROLE_KEY = 'test-service-role-key';
const ANON_KEY = 'test-anon-key';

const ID = {
  /** U、K：這把金鑰建立的 */
  a: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  /** U、手動建立（api_key_id null） */
  m: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  /** U、K2：同一位負責同仁的另一把金鑰 */
  b: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  /** O、api_key_id 被錯設成 K（驗證 created_by 這第二道防線） */
  x: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
};

/** 每個短網址各一個管道（a 的管道是本 Task 的主角；其他的用來確認沒被讀到或改到） */
const CH = {
  a: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
  m: 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',
  b: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1',
  x: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
};

type Row = Record<string, unknown>;

function urlRow(id: string, shortCode: string, createdBy: string, apiKeyId: string | null): Row {
  return {
    id,
    short_code: shortCode,
    original_url: `https://example.com/${shortCode}`,
    qr_code_generated: false,
    qr_code_path: null,
    qr_code_options: null,
    created_at: '2026-11-01T00:00:00+00:00',
    updated_at: '2026-11-01T00:00:00+00:00',
    expires_at: null,
    is_active: true,
    password_protected: false,
    password_hash: null,
    created_by: createdBy,
    updated_by: null,
    api_key_id: apiKeyId,
  };
}

/** public.url_channels 的完整欄位 */
function channelRow(id: string, urlId: string, groupKey: string): Row {
  return {
    id,
    url_id: urlId,
    group_key: groupKey,
    name: `海報 ${groupKey}`,
    utm_source: 'poster',
    utm_medium: 'qr',
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    created_at: '2026-11-01T00:00:00+00:00',
  };
}

// ============================================================
// 有狀態的假 Supabase
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COLUMNS = new Set(['id', 'created_by', 'api_key_id', 'url_id', 'channel_id']);
/** query string 裡不是篩選條件的參數 */
const NON_FILTER_PARAMS = new Set(['select', 'columns', 'order']);

/**
 * 依 query string 篩選：支援 `欄位=eq.值` 與 `欄位=not.is.null`；
 * uuid 欄位給非 UUID 值時回 PostgREST 的 22P02 錯誤；uuid 欄位比對不分大小寫（同 Postgres 的 uuid 型別）
 */
function applyFilters(rows: Row[], params: URLSearchParams): Row[] | Response {
  let result = rows;
  for (const [column, raw] of params) {
    if (NON_FILTER_PARAMS.has(column)) continue;
    if (raw === 'not.is.null') {
      result = result.filter((row) => row[column] !== null && row[column] !== undefined);
      continue;
    }
    if (!raw.startsWith('eq.')) throw new Error(`fake DB: unsupported filter ${column}=${raw}`);
    const value = raw.slice(3);
    if (UUID_COLUMNS.has(column) && !UUID.test(value)) {
      return jsonResponse(
        {
          code: '22P02',
          details: null,
          hint: null,
          message: `invalid input syntax for type uuid: "${value}"`,
        },
        400,
      );
    }
    result = UUID_COLUMNS.has(column)
      ? result.filter((row) => String(row[column]).toLowerCase() === value.toLowerCase())
      : result.filter((row) => String(row[column]) === value);
  }
  return result;
}

const wantsObject = (call: SupabaseCall) =>
  (call.headers.get('accept') || '').includes('vnd.pgrst.object');

/** .single() 要求剛好一筆；否則回整個陣列 */
function respondRows(call: SupabaseCall, rows: Row[], status = 200): Response {
  if (!wantsObject(call)) return jsonResponse(rows, status);
  return rows.length === 1 ? jsonResponse(rows[0], status) : pgrstNotFound();
}

const isServiceRole = (call: SupabaseCall) => call.headers.get('apikey') === SERVICE_ROLE_KEY;

function mockDb(options: { extraChannelsOnA?: number } = {}) {
  const db = {
    urls: [
      urlRow(ID.a, 'keyA01', U, K),
      urlRow(ID.m, 'manM01', U, null),
      urlRow(ID.b, 'keyB01', U, K2),
      urlRow(ID.x, 'othX01', O, K),
    ],
    channels: [
      channelRow(CH.a, ID.a, 'grpA01'),
      channelRow(CH.m, ID.m, 'grpM01'),
      channelRow(CH.b, ID.b, 'grpB01'),
      channelRow(CH.x, ID.x, 'grpX01'),
    ],
    clicks: [
      { url_id: ID.a, channel_id: CH.a },
      { url_id: ID.a, channel_id: CH.a },
      { url_id: ID.a, channel_id: null },
      { url_id: ID.m, channel_id: CH.m },
    ] as Row[],
  };
  for (let i = 0; i < (options.extraChannelsOnA ?? 0); i++) {
    db.channels.push(channelRow(crypto.randomUUID(), ID.a, `grpA${i}x`));
  }

  const { calls } = mockSupabaseFetch((call) => {
    const { pathname, searchParams } = call.url;

    if (pathname === '/rest/v1/rpc/verify_api_key') {
      return jsonResponse({
        status: 'ok',
        key_id: K,
        name: '報名系統',
        owner_id: U,
        scopes: ['read', 'write'],
      });
    }

    if (pathname === '/rest/v1/urls') {
      // service role 繞過 RLS；使用者 JWT 只看得到自己的（created_by = U）；其他 token 無效
      let visible: Row[];
      if (isServiceRole(call)) {
        visible = db.urls;
      } else if (call.headers.get('authorization') === `Bearer ${USER_JWT}`) {
        visible = db.urls.filter((row) => row.created_by === U);
      } else {
        return jsonResponse({ code: 'PGRST301', message: 'JWSError' }, 401);
      }
      if (call.method !== 'GET') throw new Error(`fake DB: unexpected ${call.method} urls`);
      const matched = applyFilters(visible, searchParams);
      return matched instanceof Response ? matched : respondRows(call, matched);
    }

    // 管道路由一律以 service role 存取 url_channels / url_clicks
    if (pathname === '/rest/v1/url_channels' || pathname === '/rest/v1/url_clicks') {
      if (!isServiceRole(call)) {
        return jsonResponse({ code: '42501', message: 'permission denied' }, 401);
      }
    }

    if (pathname === '/rest/v1/url_clicks') {
      if (call.method === 'POST') return new Response(null, { status: 201 });
      const matched = applyFilters(db.clicks, searchParams);
      return matched instanceof Response ? matched : respondRows(call, matched);
    }

    if (pathname === '/rest/v1/url_channels') {
      if (call.method === 'POST') {
        const inserted = JSON.parse(call.body || '{}') as Row;
        const duplicate = db.channels.some(
          (row) => row.url_id === inserted.url_id && row.group_key === inserted.group_key,
        );
        if (duplicate) return jsonResponse({ code: '23505', message: 'duplicate key' }, 409);
        const row = {
          ...channelRow(crypto.randomUUID(), '', ''),
          created_at: '2026-11-03T00:00:00+00:00',
          ...inserted,
        };
        db.channels.push(row);
        return respondRows(call, [row], 201);
      }

      const matched = applyFilters(db.channels, searchParams);
      if (matched instanceof Response) return matched;

      if (call.method === 'HEAD') {
        // .select('*', { count: 'exact', head: true })
        return new Response(null, {
          status: 200,
          headers: { 'Content-Range': `*/${matched.length}` },
        });
      }
      if (call.method === 'GET') return respondRows(call, matched);

      // .single() 的 PATCH 不是剛好一筆時，PostgREST 回 406 並回滾
      if (wantsObject(call) && matched.length !== 1) return pgrstNotFound();

      if (call.method === 'PATCH') {
        const patch = JSON.parse(call.body || '{}');
        for (const row of matched) Object.assign(row, patch);
        return respondRows(call, matched);
      }
      if (call.method === 'DELETE') {
        db.channels = db.channels.filter((row) => !matched.includes(row));
        const wantsRows = (call.headers.get('prefer') || '').includes('return=representation');
        return wantsRows ? respondRows(call, matched) : new Response(null, { status: 204 });
      }
    }

    return undefined;
  });

  return { db, calls };
}

// ============================================================
// 請求
// ============================================================

/** 以金鑰（或使用者 JWT）發出請求，並等背景工作（點擊、快取寫入）完成 */
async function send(
  env: Bindings,
  path: string,
  opts: { method?: string; body?: unknown; token?: string } = {},
) {
  const { res, settle } = await workerRequest(
    path,
    {
      method: opts.method ?? 'GET',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${opts.token ?? KEY}`,
        'Content-Type': 'application/json',
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    env,
  );
  await settle();
  return res;
}

/** 公開轉址（不帶 Authorization），回傳 302 的目的網址 */
async function redirectTarget(env: Bindings, path: string) {
  const { res, settle } = await workerRequest(path, { redirect: 'manual' }, env);
  await settle();
  await res.body?.cancel();
  expect(res.status).toBe(302);
  return new URL(res.headers.get('location')!);
}

const callsTo = (calls: SupabaseCall[], pathname: string) =>
  calls.filter((call) => call.url.pathname === pathname);

const channelsPath = (urlId: string) => `/api/urls/${urlId}/channels`;
const channelPath = (urlId: string, channelId: string) =>
  `/api/urls/${urlId}/channels/${channelId}`;

beforeEach(() => {
  // 錯誤、轉址記錄不輸出到測試結果
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 這把金鑰的短網址 a：四個端點都成功
// ============================================================

test('GET /api/urls/:a/channels（金鑰）→ 200，列出 a 的管道與點擊數', async () => {
  const { db } = mockDb();

  const res = await send(createTestEnv(), channelsPath(ID.a));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ ...db.channels[0], click_count: 2 }]);
});

test('POST /api/urls/:a/channels（金鑰）→ 201，新增到 a，group_key 6 碼英數', async () => {
  const { db } = mockDb();

  const res = await send(createTestEnv(), channelsPath(ID.a), {
    method: 'POST',
    body: { name: '  官網橫幅 ', utm_source: 'web', utm_campaign: '2026-camp' },
  });

  expect(res.status).toBe(201);
  const body = (await res.json()) as Row;
  expect(body).toMatchObject({
    url_id: ID.a,
    name: '官網橫幅',
    utm_source: 'web',
    utm_medium: null,
    utm_campaign: '2026-camp',
    utm_content: null,
    utm_term: null,
  });
  expect(body.group_key).toMatch(/^[A-Za-z0-9]{6}$/);
  expect(db.channels).toHaveLength(5);
  expect(db.channels.at(-1)).toEqual(body);
});

test('POST /api/urls/:a/channels（金鑰）→ a 已有 5 個管道時 409，不新增', async () => {
  const { db } = mockDb({ extraChannelsOnA: 4 });

  const res = await send(createTestEnv(), channelsPath(ID.a), {
    method: 'POST',
    body: { name: '第六個' },
  });

  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: '每個短網址最多 5 個管道' });
  expect(db.channels).toHaveLength(8);
});

test('PUT /api/urls/:a/channels/:ch（金鑰）→ 200，轉址 ?g= 立即使用新的 UTM（清快取）', async () => {
  const { db } = mockDb();
  const env = createTestEnv();
  // 先轉址一次，讓管道進轉址快取
  const before = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(before.searchParams.get('utm_source')).toBe('poster');

  const res = await send(env, channelPath(ID.a, CH.a), {
    method: 'PUT',
    body: { utm_source: 'line', utm_campaign: 'autumn' },
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: CH.a, utm_source: 'line', utm_campaign: 'autumn' });
  expect(db.channels[0]).toMatchObject({ utm_source: 'line', utm_campaign: 'autumn' });

  const after = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(after.searchParams.get('utm_source')).toBe('line');
  expect(after.searchParams.get('utm_campaign')).toBe('autumn');
});

test('DELETE /api/urls/:a/channels/:ch（金鑰）→ 200，下一次轉址 ?g= 不再附加 UTM（清快取）', async () => {
  const { db } = mockDb();
  const env = createTestEnv();
  const before = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(before.searchParams.get('utm_source')).toBe('poster');

  const res = await send(env, channelPath(ID.a, CH.a), { method: 'DELETE' });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: 'Channel deleted successfully' });
  expect(db.channels.map((row) => row.id)).toEqual([CH.m, CH.b, CH.x]);

  const after = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(after.toString()).toBe('https://example.com/keyA01');
});

// ============================================================
// 不屬於這把金鑰：404，url_channels / url_clicks 都沒被讀寫
// ============================================================

const NOT_THIS_KEY: Array<[string, string, string]> = [
  ['m（負責同仁手動建立）', ID.m, CH.m],
  ['b（同一位同仁的另一把金鑰）', ID.b, CH.b],
  ['x（別人的，api_key_id 被錯設成 K）', ID.x, CH.x],
  ['abc（非 UUID）', 'abc', CH.a],
];

const CHANNEL_ENDPOINTS: Array<
  [string, string, (urlId: string, channelId: string) => string, unknown]
> = [
  ['GET /api/urls/:id/channels', 'GET', (urlId) => channelsPath(urlId), undefined],
  ['POST /api/urls/:id/channels', 'POST', (urlId) => channelsPath(urlId), { name: '偷加' }],
  [
    'PUT /api/urls/:id/channels/:channelId',
    'PUT',
    channelPath,
    { name: '偷改', utm_source: 'hijacked' },
  ],
  ['DELETE /api/urls/:id/channels/:channelId', 'DELETE', channelPath, undefined],
];

test.each(
  CHANNEL_ENDPOINTS.flatMap(([label, method, path, body]) =>
    NOT_THIS_KEY.map(
      ([name, urlId, channelId]) => [label, name, method, path(urlId, channelId), body] as const,
    ),
  ),
)('%s（金鑰）對 %s → 404，url_channels 未被讀寫', async (_label, _name, method, path, body) => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.channels);
  const env = createTestEnv();

  const res = await send(env, path, { method, body });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'URL not found' });
  expect(db.channels).toEqual(before);
  expect(callsTo(calls, '/rest/v1/url_channels')).toHaveLength(0);
  expect(callsTo(calls, '/rest/v1/url_clicks')).toHaveLength(0);
});

// ============================================================
// 用自己的 a 的路徑，配上別的短網址的管道 id：a 的擁有權確認會通過，
// 之後 url_channels 以 service role 存取（繞過 RLS），擋下來的只有 url_id = a 這個條件
// ============================================================

/** PUT 再 DELETE /api/urls/:urlId/channels/:channelId，回傳 PUT 的回應內容 */
async function putThenDelete(env: Bindings, urlId: string, channelId: string, token?: string) {
  const put = await send(env, channelPath(urlId, channelId), {
    method: 'PUT',
    token,
    body: { name: '偷改', utm_source: 'hijacked' },
  });
  const putResult = { status: put.status, body: await put.json() };

  const del = await send(env, channelPath(urlId, channelId), { method: 'DELETE', token });
  await del.body?.cancel();

  return putResult;
}

test.each([
  ['m（負責同仁手動建立）', CH.m],
  ['b（同一位同仁的另一把金鑰）', CH.b],
  ['x（別人的）', CH.x],
])('PUT/DELETE /api/urls/:a/channels/:channelId（金鑰；%s 的管道）→ PUT 404、DELETE 不刪', async (
  _name,
  channelId,
) => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.channels);

  const put = await putThenDelete(createTestEnv(), ID.a, channelId);

  expect(put).toEqual({ status: 404, body: { error: 'Channel not found' } });
  expect(db.channels).toEqual(before);
  // 兩個請求都通過 a 的擁有權確認、真的送到了 url_channels（否則這個測試驗不到 url_id 條件）
  expect(callsTo(calls, '/rest/v1/url_channels').map((call) => call.method)).toEqual([
    'PATCH',
    'DELETE',
  ]);
});

// ============================================================
// 清管道快取用查到的 urls.id（正規化後的 id），不是路徑上的原始 :id
// （轉址以資料庫的 id 寫快取鍵 ch:<url_id>:<group_key>；路徑用大寫 UUID 時，
//  以原始 :id 清快取會清到不存在的鍵，最多 60 秒內仍用舊的 UTM）
// ============================================================

const CALLERS: Array<[string, string | undefined]> = [
  ['金鑰', undefined],
  ['使用者 JWT', USER_JWT],
];

test.each(CALLERS)('PUT /api/urls/:A（大寫 UUID）/channels/:ch（%s）→ 轉址 ?g= 立即使用新的 UTM', async (
  _caller,
  token,
) => {
  const { db } = mockDb();
  const env = createTestEnv();
  const before = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(before.searchParams.get('utm_source')).toBe('poster');

  const res = await send(env, channelPath(ID.a.toUpperCase(), CH.a), {
    method: 'PUT',
    token,
    body: { utm_source: 'line' },
  });

  expect(res.status).toBe(200);
  expect(db.channels[0]).toMatchObject({ utm_source: 'line' });
  const after = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(after.searchParams.get('utm_source')).toBe('line');
});

test.each(CALLERS)('DELETE /api/urls/:A（大寫 UUID）/channels/:ch（%s）→ 下一次轉址 ?g= 不再附加 UTM', async (
  _caller,
  token,
) => {
  const { db } = mockDb();
  const env = createTestEnv();
  const before = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(before.searchParams.get('utm_source')).toBe('poster');

  const res = await send(env, channelPath(ID.a.toUpperCase(), CH.a), { method: 'DELETE', token });

  expect(res.status).toBe(200);
  expect(db.channels.map((row) => row.id)).toEqual([CH.m, CH.b, CH.x]);
  const after = await redirectTarget(env, '/s/keyA01?g=grpA01');
  expect(after.toString()).toBe('https://example.com/keyA01');
});

// ============================================================
// :channelId 不是 UUID → 404（兩種呼叫者），不是 500；不送到 url_channels
// ============================================================

test.each(CALLERS)('PUT/DELETE /api/urls/:a/channels/abc（%s；非 UUID 的管道 id）→ 404 Channel not found', async (
  _caller,
  token,
) => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.channels);
  const env = createTestEnv();

  const put = await send(env, channelPath(ID.a, 'abc'), {
    method: 'PUT',
    token,
    body: { name: '改名' },
  });
  const del = await send(env, channelPath(ID.a, 'abc'), { method: 'DELETE', token });

  expect({ status: del.status, body: await del.json() }).toEqual({
    status: 404,
    body: { error: 'Channel not found' },
  });
  expect({ status: put.status, body: await put.json() }).toEqual({
    status: 404,
    body: { error: 'Channel not found' },
  });
  expect(db.channels).toEqual(before);
  // a 的擁有權確認照常進行（兩次），之後不查 url_channels
  expect(callsTo(calls, '/rest/v1/urls')).toHaveLength(2);
  expect(callsTo(calls, '/rest/v1/url_channels')).toHaveLength(0);
});

// ============================================================
// 每個金鑰請求：service role + x-tcurl-api-key-id、兩個條件、不呼叫 Supabase Auth
// ============================================================

test('金鑰請求走遍四個管道端點：不呼叫 /auth/v1/user；urls 查詢都帶兩個條件；完整金鑰不外流', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  const requests: Array<[number, string, string, unknown?]> = [
    [404, 'GET', channelsPath(ID.m)],
    [200, 'GET', channelsPath(ID.a)],
    [404, 'POST', channelsPath(ID.m), { name: 'm' }],
    [201, 'POST', channelsPath(ID.a), { name: 'a' }],
    [404, 'PUT', channelPath(ID.m, CH.m), { utm_source: 'm' }],
    [200, 'PUT', channelPath(ID.a, CH.a), { utm_source: 'a' }],
    [404, 'DELETE', channelPath(ID.m, CH.m)],
    [200, 'DELETE', channelPath(ID.a, CH.a)],
  ];
  const responses: string[] = [];
  for (const [status, method, path, body] of requests) {
    const res = await send(env, path, { method, body });
    expect(res.status, `${method} ${path}`).toBe(status);
    responses.push(JSON.stringify([...res.headers]), await res.text());
  }

  expect(callsTo(calls, '/auth/v1/user')).toHaveLength(0);

  // 除了驗證金鑰的 RPC，所有 Supabase 請求都經 getSupabaseForApiKey
  const routeCalls = calls.filter((call) => call.url.pathname !== '/rest/v1/rpc/verify_api_key');
  for (const call of routeCalls) {
    expect(isServiceRole(call), `${call.method} ${call.url}`).toBe(true);
    expect(call.headers.get('x-tcurl-api-key-id'), `${call.method} ${call.url}`).toBe(K);
  }

  // 8 個請求各確認一次擁有權，每次都帶兩個條件
  const urlLookups = callsTo(calls, '/rest/v1/urls');
  expect(urlLookups).toHaveLength(8);
  for (const call of urlLookups) {
    expect(call.url.searchParams.get('created_by'), `${call.method} ${call.url}`).toBe(`eq.${U}`);
    expect(call.url.searchParams.get('api_key_id'), `${call.method} ${call.url}`).toBe(`eq.${K}`);
  }

  // 完整金鑰不送到 Supabase（驗證只送雜湊）、不出現在回應或記錄
  for (const call of calls) {
    expect(`${call.url} ${JSON.stringify([...call.headers])} ${call.body}`).not.toContain(KEY);
  }
  expect(responses.join('\n')).not.toContain(KEY);
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    expect(JSON.stringify(vi.mocked(console[method]).mock.calls)).not.toContain(KEY);
  }
});

// ============================================================
// 使用者（JWT）
// ============================================================

test('使用者 JWT 的管道端點照舊：以 user client（RLS）確認 URL，不加金鑰條件', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  const own = await send(env, channelsPath(ID.m), { token: USER_JWT });
  expect(own.status).toBe(200);
  await own.body?.cancel();

  const others = await send(env, channelsPath(ID.x), { token: USER_JWT });
  expect(others.status).toBe(404);
  await others.body?.cancel();

  const put = await send(env, channelPath(ID.m, CH.m), {
    method: 'PUT',
    token: USER_JWT,
    body: { name: '改名' },
  });
  expect(put.status).toBe(200);
  await put.body?.cancel();

  const urlLookups = callsTo(calls, '/rest/v1/urls');
  expect(urlLookups).toHaveLength(3);
  for (const call of urlLookups) {
    expect(call.headers.get('apikey')).toBe(ANON_KEY);
    expect(call.headers.get('authorization')).toBe(`Bearer ${USER_JWT}`);
    expect(call.url.searchParams.has('created_by')).toBe(false);
    expect(call.url.searchParams.has('api_key_id')).toBe(false);
  }
  // url_channels / url_clicks 跟以前一樣用 service role（不帶 x-tcurl-api-key-id）
  for (const call of calls.filter((c) => c.url.pathname !== '/rest/v1/urls')) {
    expect(isServiceRole(call), `${call.method} ${call.url}`).toBe(true);
    expect(call.headers.has('x-tcurl-api-key-id'), `${call.method} ${call.url}`).toBe(false);
  }
});

test('使用者 JWT：用自己的 a 的路徑改／刪別人 x 的管道 → PUT 404、DELETE 不刪', async () => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.channels);

  const put = await putThenDelete(createTestEnv(), ID.a, CH.x, USER_JWT);

  expect(put).toEqual({ status: 404, body: { error: 'Channel not found' } });
  expect(db.channels).toEqual(before);
  expect(callsTo(calls, '/rest/v1/url_channels').map((call) => call.method)).toEqual([
    'PATCH',
    'DELETE',
  ]);
});
