/**
 * 管理者 API：服務 API 金鑰（src/routes/admin.ts；spec §6.6）
 *
 * - 只有管理者（getAdminUser）能呼叫；金鑰（Bearer tcurl_sk_…）由 api-key-auth 中介層擋下（401）
 * - 發放：Worker 產生金鑰，create_api_key 只收前綴與雜湊；完整金鑰只出現在 201 回應，
 *   不進 RPC body、不進記錄
 * - RPC 錯誤（PostgREST 錯誤物件的 code + message）：
 *   P0002 owner_not_found → 400、P0002 api_key_not_found → 404、22023（管理者輸入的名稱、權限、到期日）→ 400；
 *   22023 但不是管理者輸入（invalid_actor、invalid_key_hash、invalid_key_prefix：Worker 傳錯參數）→ 500 並記錄
 * - :id 不是 UUID → 404，不呼叫 RPC
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { hashApiKey } from '../src/services/api-keys.ts';
import { jsonResponse, mockSupabaseFetch, workerRequest } from './helpers/test-env.ts';

const ADMIN_ID = '99999999-9999-9999-9999-999999999999';
const KEY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const AUTH = { Authorization: 'Bearer admin-jwt' };
const JSON_HEADERS = { ...AUTH, 'Content-Type': 'application/json' };
const DAY_MS = 24 * 60 * 60 * 1000;
const KEY_FORMAT = /^tcurl_sk_[A-Za-z0-9_-]{43}$/;
const OWNER_NOT_FOUND_BODY = { error: '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）' };
const INVALID_KEY_BODY = { error: 'Unauthorized', message: 'API 金鑰無效或已失效' };
const CREATE_PARAMS = [
  'p_actor',
  'p_expires_at',
  'p_key_hash',
  'p_key_prefix',
  'p_name',
  'p_owner_email',
  'p_scopes',
];

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
let consoleSpies: Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  // 攔下所有 console 輸出：保持測試輸出乾淨，並用來檢查記錄內容不含完整金鑰
  consoleSpies = Object.fromEntries(
    (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => [
      m,
      vi.spyOn(console, m).mockImplementation(() => {}),
    ]),
  ) as typeof consoleSpies;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 所有 console 輸出（序列化後） */
function loggedText(): string {
  return Object.values(consoleSpies)
    .flatMap((spy) => spy.mock.calls)
    .map((args) => JSON.stringify(args, (_k, v) => (v instanceof Error ? v.message : v)))
    .join('\n');
}

// ============================================================
// 測試替身
// ============================================================

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: ADMIN_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** 金鑰 RPC 回傳的單筆（形狀同 migration 的 api_key_json；不含 key_hash） */
function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY_ID,
    name: '報名系統',
    key_prefix: 'tcurl_sk_Ab12Cd',
    scopes: ['read', 'write'],
    owner_id: OWNER_ID,
    owner_email: 'kael1996@tzuchi.org.tw',
    owner_status: 'active',
    owner_last_sign_in_at: '2026-11-01T00:00:00Z',
    created_by_email: 'admin@example.com',
    created_at: '2026-11-03T00:00:00Z',
    expires_at: '2027-11-03T00:00:00Z',
    revoked_at: null,
    last_used_at: null,
    status: 'active',
    url_count: 3,
    ...overrides,
  };
}

/** PostgREST 錯誤物件（RAISE … USING ERRCODE：P0002 → HTTP 500，22023 → HTTP 400） */
function pgError(code: string, message: string, status: number): Response {
  return jsonResponse({ code, message, details: null, hint: null }, status);
}

type RpcHandler = (args: Record<string, unknown>) => Response;

/** 每個金鑰 RPC 都成功回一筆（用來確認「被拒的請求沒有呼叫任何 RPC」） */
const ALL_RPCS_OK: Record<string, RpcHandler> = {
  list_api_keys: () => jsonResponse([keyRow()]),
  create_api_key: () => jsonResponse(keyRow()),
  revoke_api_key: () => jsonResponse(keyRow({ status: 'revoked' })),
  update_api_key: () => jsonResponse(keyRow()),
  verify_api_key: () =>
    jsonResponse({
      status: 'ok',
      key_id: KEY_ID,
      name: 'svc',
      owner_id: OWNER_ID,
      scopes: ['read', 'write'],
    }),
};

/**
 * /auth/v1/user 回 user（預設為管理者）；POST /rest/v1/rpc/<name> 交給 rpc[name]。
 * 其他請求走 mockSupabaseFetch 的預設（401）。
 */
function mockDb(rpc: Record<string, RpcHandler> = {}, user: Record<string, unknown> = authUser()) {
  const { calls } = mockSupabaseFetch((call) => {
    const path = call.url.pathname;
    if (path === '/auth/v1/user') return jsonResponse(user);
    const name = path.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (name && call.method === 'POST' && rpc[name]) {
      return rpc[name](JSON.parse(call.body || '{}'));
    }
    return undefined;
  });
  const rpcCalls = () =>
    calls
      .filter((call) => call.url.pathname.startsWith('/rest/v1/rpc/'))
      .map((call) => ({
        name: call.url.pathname.slice('/rest/v1/rpc/'.length),
        args: JSON.parse(call.body || '{}') as Record<string, unknown>,
        rawBody: call.body ?? '',
      }));
  return { calls, rpcCalls };
}

function postJson(path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return workerRequest(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

function putJson(path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return workerRequest(path, { method: 'PUT', headers, body: JSON.stringify(body) });
}

/** ISO 時間是否約為現在 + days 天（容許 1 分鐘誤差） */
function expectAboutDaysFromNow(iso: unknown, days: number) {
  expect(typeof iso).toBe('string');
  const diff = Date.parse(iso as string) - (Date.now() + days * DAY_MS);
  expect(Math.abs(diff)).toBeLessThan(60_000);
}

const ENDPOINTS: Array<[method: string, path: string, body: unknown]> = [
  ['GET', '/api/admin/api-keys', undefined],
  ['POST', '/api/admin/api-keys', { name: '報名系統', owner_email: 'kael1996@tzuchi.org.tw' }],
  ['POST', `/api/admin/api-keys/${KEY_ID}/revoke`, undefined],
  ['PUT', `/api/admin/api-keys/${KEY_ID}`, { name: '新名稱' }],
];

function request(method: string, path: string, body: unknown, headers: Record<string, string>) {
  return workerRequest(path, {
    method,
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ============================================================
// 管理者判斷與金鑰請求
// ============================================================

describe('只有管理者能呼叫', () => {
  test.each(ENDPOINTS)('%s %s - 非管理者 → 401，不呼叫任何 RPC', async (method, path, body) => {
    const { rpcCalls } = mockDb(ALL_RPCS_OK, authUser({ email: 'someone@tzuchi.org.tw' }));
    const { res } = await request(method, path, body, AUTH);
    expect(res.status).toBe(401);
    await res.body?.cancel();
    expect(rpcCalls()).toEqual([]);
  });

  test.each(ENDPOINTS)(
    '%s %s - 管理者 email 未驗證 → 401，不呼叫任何 RPC',
    async (method, path, body) => {
      const { rpcCalls } = mockDb(ALL_RPCS_OK, authUser({ email_confirmed_at: null }));
      const { res } = await request(method, path, body, AUTH);
      expect(res.status).toBe(401);
      await res.body?.cancel();
      expect(rpcCalls()).toEqual([]);
    },
  );

  test.each(ENDPOINTS)('%s %s - 沒有 Authorization → 401，不呼叫任何 RPC', async (method, path, body) => {
    const { rpcCalls } = mockDb(ALL_RPCS_OK);
    const { res } = await request(method, path, body, {});
    expect(res.status).toBe(401);
    await res.body?.cancel();
    expect(rpcCalls()).toEqual([]);
  });

  test.each(ENDPOINTS)(
    '%s %s - 有效的服務 API 金鑰 → 401（中介層擋下），不呼叫金鑰管理 RPC',
    async (method, path, body) => {
      const { calls, rpcCalls } = mockDb(ALL_RPCS_OK);
      const { res } = await request(method, path, body, {
        Authorization: 'Bearer tcurl_sk_Zx9Qw3Er5Ty7Ui1Op0As2Df4Gh6Jk8LzXcVbNm-_Q1w',
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(INVALID_KEY_BODY);
      expect(rpcCalls().map((call) => call.name)).toEqual(['verify_api_key']);
      expect(calls.some((call) => call.url.pathname === '/auth/v1/user')).toBe(false);
    },
  );
});

// ============================================================
// 回應不快取（POST 201 含完整金鑰；列表含負責同仁 email）
// ============================================================

describe('Cache-Control: no-store', () => {
  test.each(ENDPOINTS)('%s %s - 成功的回應帶 Cache-Control: no-store', async (method, path, body) => {
    mockDb(ALL_RPCS_OK);
    const { res } = await request(method, path, body, AUTH);
    expect(res.status).toBe(method === 'POST' && path === '/api/admin/api-keys' ? 201 : 200);
    await res.body?.cancel();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('錯誤回應（非管理者 401、內容不合法 400）也帶 no-store', async () => {
    mockDb(ALL_RPCS_OK, authUser({ email: 'someone@tzuchi.org.tw' }));
    const denied = await workerRequest('/api/admin/api-keys', { headers: AUTH });
    expect(denied.res.status).toBe(401);
    expect(denied.res.headers.get('Cache-Control')).toBe('no-store');

    mockDb(ALL_RPCS_OK);
    const invalid = await postJson('/api/admin/api-keys', ['not', 'an', 'object']);
    expect(invalid.res.status).toBe(400);
    expect(invalid.res.headers.get('Cache-Control')).toBe('no-store');
  });
});

// ============================================================
// GET /api/admin/api-keys
// ============================================================

describe('GET /api/admin/api-keys', () => {
  test('回傳 list_api_keys 的陣列，每筆都不含 key、key_hash', async () => {
    const rows = [
      keyRow(),
      keyRow({ id: '33333333-3333-4333-8333-333333333333', status: 'revoked' }),
    ];
    const { rpcCalls } = mockDb({ list_api_keys: () => jsonResponse(rows) });

    const { res } = await workerRequest('/api/admin/api-keys', { headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toEqual(rows);
    for (const row of body) {
      expect(row).not.toHaveProperty('key');
      expect(row).not.toHaveProperty('key_hash');
    }
    expect(rpcCalls().map((call) => call.name)).toEqual(['list_api_keys']);
  });

  test('RPC 發生非預期錯誤 → 500，不回傳資料庫錯誤原文', async () => {
    mockDb({ list_api_keys: () => pgError('XX000', 'internal_secret_detail', 500) });
    const { res } = await workerRequest('/api/admin/api-keys', { headers: AUTH });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('internal_secret_detail');
  });
});

// ============================================================
// POST /api/admin/api-keys（發放）
// ============================================================

describe('POST /api/admin/api-keys', () => {
  test('預設：產生金鑰、RPC 只收雜湊與前綴；201 回應唯一一次帶完整金鑰', async () => {
    const { rpcCalls } = mockDb({ create_api_key: () => jsonResponse(keyRow()) });

    // 負責同仁 email 原樣傳給 RPC（大小寫與空白由 SQL 處理，Review Focus 4）
    const { res } = await postJson('/api/admin/api-keys', {
      name: '報名系統',
      owner_email: ' Kael1996@Tzuchi.org.tw ',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;

    const calls = rpcCalls();
    expect(calls.map((call) => call.name)).toEqual(['create_api_key']);
    const { args, rawBody } = calls[0];
    expect(Object.keys(args).sort()).toEqual(CREATE_PARAMS);
    expect(args.p_name).toBe('報名系統');
    expect(args.p_owner_email).toBe(' Kael1996@Tzuchi.org.tw ');
    expect(args.p_scopes).toEqual(['read', 'write']);
    expect(args.p_actor).toBe(ADMIN_ID);
    expect(args.p_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_key_prefix).toMatch(/^tcurl_sk_/);
    expectAboutDaysFromNow(args.p_expires_at, 365);

    // 回應：RPC 的單筆欄位 + 完整金鑰
    const key = body.key as string;
    expect(key).toMatch(KEY_FORMAT);
    expect(await hashApiKey(key)).toBe(args.p_key_hash);
    expect(key.slice(0, 15)).toBe(args.p_key_prefix);
    expect(body).toEqual({ ...keyRow(), key });

    // 完整金鑰不進 RPC body、不進記錄
    expect(rawBody).not.toContain(key);
    expect(loggedText()).not.toContain(key);
  });

  test('指定權限與 90 天到期', async () => {
    const { rpcCalls } = mockDb({
      create_api_key: () => jsonResponse(keyRow({ scopes: ['read'] })),
    });
    const { res } = await postJson('/api/admin/api-keys', {
      name: '報名系統',
      owner_email: 'kael1996@tzuchi.org.tw',
      scopes: ['read'],
      expires_in_days: 90,
    });
    expect(res.status).toBe(201);
    await res.body?.cancel();
    const [{ args }] = rpcCalls();
    expect(args.p_scopes).toEqual(['read']);
    expectAboutDaysFromNow(args.p_expires_at, 90);
  });

  test('expires_in_days: null → 不過期（p_expires_at 為 null）', async () => {
    const { rpcCalls } = mockDb({
      create_api_key: () => jsonResponse(keyRow({ expires_at: null })),
    });
    const { res } = await postJson('/api/admin/api-keys', {
      name: '報名系統',
      owner_email: 'kael1996@tzuchi.org.tw',
      expires_in_days: null,
    });
    expect(res.status).toBe(201);
    await res.body?.cancel();
    const [{ args }] = rpcCalls();
    expect(args.p_expires_at).toBeNull();
  });

  const valid = { name: '報名系統', owner_email: 'kael1996@tzuchi.org.tw' };
  test.each<[string, unknown]>([
    ['expires_in_days: 30', { ...valid, expires_in_days: 30 }],
    ['expires_in_days: "365"（字串）', { ...valid, expires_in_days: '365' }],
    ['expires_in_days: -90（過去的到期日，Review Focus 3）', { ...valid, expires_in_days: -90 }],
    ['expires_in_days: 0', { ...valid, expires_in_days: 0 }],
    ['scopes 含不合法的值', { ...valid, scopes: ['read', 'admin'] }],
    ['scopes 為空陣列', { ...valid, scopes: [] }],
    ['scopes 不是陣列', { ...valid, scopes: 'read' }],
    ['缺少 name', { owner_email: 'kael1996@tzuchi.org.tw' }],
    ['name 不是字串', { ...valid, name: 123 }],
    ['缺少 owner_email', { name: '報名系統' }],
    ['body 是陣列', [valid]],
  ])('%s → 400，不呼叫 RPC、不回傳金鑰', async (_label, payload) => {
    const { rpcCalls } = mockDb({ create_api_key: () => jsonResponse(keyRow()) });
    const { res } = await postJson('/api/admin/api-keys', payload);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body).not.toHaveProperty('key');
    expect(rpcCalls()).toEqual([]);
  });

  test('body 不是合法 JSON → 400，不呼叫 RPC', async () => {
    const { rpcCalls } = mockDb({ create_api_key: () => jsonResponse(keyRow()) });
    const { res } = await workerRequest('/api/admin/api-keys', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{not json',
    });
    expect(res.status).toBe(400);
    await res.body?.cancel();
    expect(rpcCalls()).toEqual([]);
  });

  test('RPC 回 P0002 owner_not_found → 400 與「找不到這位同仁」，不回傳金鑰', async () => {
    mockDb({ create_api_key: () => pgError('P0002', 'owner_not_found', 500) });
    const { res } = await postJson('/api/admin/api-keys', valid);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(OWNER_NOT_FOUND_BODY);
  });

  test('RPC 回 22023（例如到期日不在未來）→ 400，不回傳金鑰', async () => {
    mockDb({ create_api_key: () => pgError('22023', 'invalid_expires_at', 400) });
    const { res } = await postJson('/api/admin/api-keys', valid);
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body).not.toHaveProperty('key');
  });

  test('RPC 發生非預期錯誤 → 500，回應與記錄都不含完整金鑰或資料庫錯誤原文', async () => {
    const { rpcCalls } = mockDb({
      create_api_key: () => pgError('23505', 'duplicate key value violates unique constraint', 409),
    });
    const { res } = await postJson('/api/admin/api-keys', valid);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('tcurl_sk_');
    expect(text).not.toContain('duplicate key');
    expect(rpcCalls()).toHaveLength(1);
    expect(loggedText()).not.toMatch(/tcurl_sk_[A-Za-z0-9_-]{43}/);
  });
});

// ============================================================
// POST /api/admin/api-keys/:id/revoke
// ============================================================

describe('POST /api/admin/api-keys/:id/revoke', () => {
  test('以金鑰 id 與管理者 id 呼叫 revoke_api_key，回傳單筆', async () => {
    const row = keyRow({ status: 'revoked', revoked_at: '2026-11-03T01:00:00Z' });
    const { rpcCalls } = mockDb({ revoke_api_key: () => jsonResponse(row) });
    const { res } = await workerRequest(`/api/admin/api-keys/${KEY_ID}/revoke`, {
      method: 'POST',
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(row);
    expect(rpcCalls().map(({ name, args }) => ({ name, args }))).toEqual([
      { name: 'revoke_api_key', args: { p_key_id: KEY_ID, p_actor: ADMIN_ID } },
    ]);
  });

  test('RPC 回 P0002 api_key_not_found → 404', async () => {
    mockDb({ revoke_api_key: () => pgError('P0002', 'api_key_not_found', 500) });
    const { res } = await workerRequest(`/api/admin/api-keys/${KEY_ID}/revoke`, {
      method: 'POST',
      headers: AUTH,
    });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  test.each(['abc', '123', `${KEY_ID}0`, 'not-a-uuid-at-all-0000000000000000'])(
    ':id = %s（不是 UUID）→ 404，不呼叫 RPC',
    async (id) => {
      const { rpcCalls } = mockDb(ALL_RPCS_OK);
      const { res } = await workerRequest(`/api/admin/api-keys/${id}/revoke`, {
        method: 'POST',
        headers: AUTH,
      });
      expect(res.status).toBe(404);
      await res.body?.cancel();
      expect(rpcCalls()).toEqual([]);
    },
  );
});

// ============================================================
// PUT /api/admin/api-keys/:id（改名稱、到期日、轉移負責同仁）
// ============================================================

describe('PUT /api/admin/api-keys/:id', () => {
  test('轉移負責同仁：以正確參數呼叫 update_api_key（email 原樣傳遞），回傳單筆', async () => {
    const row = keyRow({ owner_email: 'new@tzuchi.org.tw' });
    const { rpcCalls } = mockDb({ update_api_key: () => jsonResponse(row) });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, {
      owner_email: ' New@Tzuchi.org.tw ',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(row);
    expect(rpcCalls().map(({ name, args }) => ({ name, args }))).toEqual([
      {
        name: 'update_api_key',
        args: {
          p_key_id: KEY_ID,
          p_actor: ADMIN_ID,
          p_name: null,
          p_expires_at: null,
          p_clear_expiry: false,
          p_new_owner_email: ' New@Tzuchi.org.tw ',
        },
      },
    ]);
  });

  test('改名稱與 90 天到期', async () => {
    const { rpcCalls } = mockDb({ update_api_key: () => jsonResponse(keyRow({ name: '新名稱' })) });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, {
      name: '新名稱',
      expires_in_days: 90,
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    const [{ name, args }] = rpcCalls();
    expect(name).toBe('update_api_key');
    expect(args).toMatchObject({
      p_key_id: KEY_ID,
      p_actor: ADMIN_ID,
      p_name: '新名稱',
      p_clear_expiry: false,
      p_new_owner_email: null,
    });
    expectAboutDaysFromNow(args.p_expires_at, 90);
  });

  test('expires_in_days: null → 改成不過期（p_clear_expiry: true）', async () => {
    const { rpcCalls } = mockDb({
      update_api_key: () => jsonResponse(keyRow({ expires_at: null })),
    });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, { expires_in_days: null });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    const [{ args }] = rpcCalls();
    expect(args).toMatchObject({ p_expires_at: null, p_clear_expiry: true, p_name: null });
  });

  test.each<[string, unknown]>([
    ['expires_in_days: 30', { expires_in_days: 30 }],
    ['expires_in_days: -1', { expires_in_days: -1 }],
    ['name 不是字串', { name: 123 }],
    ['owner_email 不是字串', { owner_email: ['a@tzuchi.org.tw'] }],
    ['body 不是物件', 'rename'],
  ])('%s → 400，不呼叫 RPC', async (_label, payload) => {
    const { rpcCalls } = mockDb(ALL_RPCS_OK);
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, payload);
    expect(res.status).toBe(400);
    await res.body?.cancel();
    expect(rpcCalls()).toEqual([]);
  });

  test('RPC 回 P0002 api_key_not_found → 404', async () => {
    mockDb({ update_api_key: () => pgError('P0002', 'api_key_not_found', 500) });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, { name: '新名稱' });
    expect(res.status).toBe(404);
    await res.body?.cancel();
  });

  test('轉移時 RPC 回 P0002 owner_not_found → 400 與「找不到這位同仁」', async () => {
    mockDb({ update_api_key: () => pgError('P0002', 'owner_not_found', 500) });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, {
      owner_email: 'nobody@tzuchi.org.tw',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(OWNER_NOT_FOUND_BODY);
  });

  test('RPC 回 22023（例如名稱空白）→ 400', async () => {
    mockDb({ update_api_key: () => pgError('22023', 'invalid_name', 400) });
    const { res } = await putJson(`/api/admin/api-keys/${KEY_ID}`, { name: '   ' });
    expect(res.status).toBe(400);
    await res.body?.cancel();
  });

  test.each(['abc', '123', `${KEY_ID}0`])(':id = %s（不是 UUID）→ 404，不呼叫 RPC', async (id) => {
    const { rpcCalls } = mockDb(ALL_RPCS_OK);
    const { res } = await putJson(`/api/admin/api-keys/${id}`, { name: '新名稱' });
    expect(res.status).toBe(404);
    await res.body?.cancel();
    expect(rpcCalls()).toEqual([]);
  });
});

// ============================================================
// RPC 以 22023 拒絕 Worker 自己傳錯的參數（不是管理者的輸入）
// ============================================================

describe('22023 但不是管理者輸入的參數 → 500 並記錄', () => {
  const createPath = '/api/admin/api-keys';
  const createBody = { name: '報名系統', owner_email: 'kael1996@tzuchi.org.tw' };
  const revokePath = `/api/admin/api-keys/${KEY_ID}/revoke`;
  const updatePath = `/api/admin/api-keys/${KEY_ID}`;

  type Row = [label: string, method: string, path: string, body: unknown, rpc: string, msg: string];
  test.each<Row>([
    ['發放：key_hash 格式不符', 'POST', createPath, createBody, 'create_api_key', 'invalid_key_hash'],
    ['發放：key_prefix 格式不符', 'POST', createPath, createBody, 'create_api_key', 'invalid_key_prefix'],
    ['發放：p_actor 為 null', 'POST', createPath, createBody, 'create_api_key', 'invalid_actor'],
    ['撤銷：p_actor 為 null', 'POST', revokePath, undefined, 'revoke_api_key', 'invalid_actor'],
    ['修改：p_actor 為 null', 'PUT', updatePath, { name: '新名稱' }, 'update_api_key', 'invalid_actor'],
  ])(
    '%s → 500（不是「輸入資料不正確」的 400），console.error 記下 code 與 message',
    async (_label, method, path, body, rpc, msg) => {
      const { rpcCalls } = mockDb({ [rpc]: () => pgError('22023', msg, 400) });
      const { res } = await request(method, path, body, AUTH);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain('輸入資料不正確');
      expect(text).not.toContain(msg);
      expect(text).not.toContain('tcurl_sk_');
      expect(rpcCalls().map(({ name }) => name)).toEqual([rpc]);
      expect(consoleSpies.error).toHaveBeenCalledWith(expect.any(String), '22023', msg);
      expect(loggedText()).not.toMatch(/tcurl_sk_[A-Za-z0-9_-]{43}/);
    },
  );
});
