/**
 * 服務 API 金鑰：短網址 CRUD 與統計路由（src/routes/url-crud.ts、url-stats.ts；spec §6.3、§6.4、§6.7、§8）
 *
 * - 金鑰請求用 getSupabaseForApiKey（service role，繞過 RLS，帶 x-tcurl-api-key-id），所以對 urls 的
 *   每個查詢、修改、刪除都要同時限定 created_by = 負責同仁、api_key_id = 這把金鑰；不屬於這把金鑰
 *   （含非 UUID 的 :id）一律 404
 * - 統計 RPC 傳 p_user_id = 負責同仁、p_api_key_id = 這把金鑰；get_url_stats 前先確認擁有權
 * - 金鑰請求不呼叫 Supabase Auth（/auth/v1/user）；PUT/DELETE 照樣清轉址快取
 * - GET /api/urls/:id（金鑰、使用者兩種呼叫者）在 api_key_id 非 null 時附上 api_key_name、api_key_revoked
 *
 * 假資料庫依 query string 的 `欄位=eq.值` 篩選，service role 看得到所有資料列（同真實的 RLS 繞過），
 * 所以少帶任何一個條件，測試資料 m／b／x 就會被查到或改到。
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
/** 同一位負責同仁的另一把金鑰（已撤銷） */
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

const API_KEYS = [
  { id: K, name: '報名系統', revoked_at: null },
  { id: K2, name: '舊報名系統', revoked_at: '2026-11-02T00:00:00+00:00' },
];

const AUTH_USER = {
  id: U,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'owner@tzuchi.org.tw',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};

const RPC_RESULTS: Record<string, unknown> = {
  get_urls_with_stats: {
    data: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
  },
  get_stats_summary: { totalLinks: 1, activeLinks: 1, totalClicks: 0 },
  get_daily_stats: [],
  get_url_stats: { totalClicks: 0, daily: [], channels: [] },
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

// ============================================================
// 有狀態的假 Supabase
// ============================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COLUMNS = new Set(['id', 'created_by', 'api_key_id']);
/** query string 裡不是篩選條件的參數 */
const NON_FILTER_PARAMS = new Set(['select', 'columns']);

/** 依 query string 的 `欄位=eq.值` 篩選；uuid 欄位給非 UUID 值時回 PostgREST 的 22P02 錯誤 */
function applyFilters(rows: Row[], params: URLSearchParams): Row[] | Response {
  let result = rows;
  for (const [column, raw] of params) {
    if (NON_FILTER_PARAMS.has(column)) continue;
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
    result = result.filter((row) => String(row[column]) === value);
  }
  return result;
}

/** .single() 要求剛好一筆；否則回整個陣列 */
function respondRows(call: SupabaseCall, rows: Row[], status = 200): Response {
  const wantsObject = (call.headers.get('accept') || '').includes('vnd.pgrst.object');
  if (!wantsObject) return jsonResponse(rows, status);
  return rows.length === 1 ? jsonResponse(rows[0], status) : pgrstNotFound();
}

/** public.urls 的完整欄位（同 urlRow） */
const URL_COLUMNS = Object.keys(urlRow('', '', '', null));

/**
 * PostgREST 的 select：沒帶或 `*` 回整列，否則只回列出的欄位；
 * 欄位不存在時回 42703（欄位名稱打錯時，真的 PostgREST 也會整個請求失敗）
 */
function selectUrlColumns(rows: Row[], params: URLSearchParams): Row[] | Response {
  const select = params.get('select');
  if (!select || select === '*') return rows;
  const columns = select.split(',');
  const unknown = columns.find((column) => !URL_COLUMNS.includes(column));
  if (unknown !== undefined) {
    return jsonResponse(
      { code: '42703', details: null, hint: null, message: `column urls.${unknown} does not exist` },
      400,
    );
  }
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]])));
}

/** urls 的回應：依 select 取欄位後回傳 */
function respondUrls(call: SupabaseCall, rows: Row[], status = 200): Response {
  const selected = selectUrlColumns(rows, call.url.searchParams);
  return selected instanceof Response ? selected : respondRows(call, selected, status);
}

const isServiceRole = (call: SupabaseCall) => call.headers.get('apikey') === SERVICE_ROLE_KEY;

function mockDb() {
  const db = {
    urls: [
      urlRow(ID.a, 'keyA01', U, K),
      urlRow(ID.m, 'manM01', U, null),
      urlRow(ID.b, 'keyB01', U, K2),
      urlRow(ID.x, 'othX01', O, K),
    ],
  };

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

    if (pathname === '/auth/v1/user') {
      return call.headers.get('authorization') === `Bearer ${USER_JWT}`
        ? jsonResponse(AUTH_USER)
        : jsonResponse({ code: 403, message: 'invalid JWT' }, 403);
    }

    if (pathname.startsWith('/rest/v1/rpc/')) {
      // 統計 RPC 只授權 service_role
      if (!isServiceRole(call)) {
        return jsonResponse({ code: '42501', message: 'permission denied' }, 401);
      }
      return jsonResponse(RPC_RESULTS[pathname.slice('/rest/v1/rpc/'.length)]);
    }

    if (pathname === '/rest/v1/api_keys' && call.method === 'GET') {
      // RLS 開啟且沒有 policy：只有 service role 讀得到
      const matched = applyFilters(isServiceRole(call) ? API_KEYS : [], searchParams);
      return matched instanceof Response ? matched : respondRows(call, matched);
    }

    if (pathname === '/rest/v1/url_clicks' && call.method === 'POST') {
      return new Response(null, { status: 201 });
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
      // select 有不存在的欄位：整個請求失敗，不新增、不修改
      const badSelect = selectUrlColumns([], searchParams);
      if (badSelect instanceof Response) return badSelect;

      if (call.method === 'POST') {
        const inserted = JSON.parse(call.body || '{}');
        const row = { ...urlRow(crypto.randomUUID(), '', '', null), ...inserted };
        db.urls.push(row);
        return respondUrls(call, [row], 201);
      }

      const matched = applyFilters(visible, searchParams);
      if (matched instanceof Response) return matched;
      if (call.method === 'GET') return respondUrls(call, matched);

      // .single() 的 PATCH / DELETE 不是剛好一筆時，PostgREST 回 406 並回滾
      const wantsObject = (call.headers.get('accept') || '').includes('vnd.pgrst.object');
      if (wantsObject && matched.length !== 1) return pgrstNotFound();

      if (call.method === 'PATCH') {
        const patch = JSON.parse(call.body || '{}');
        for (const row of matched) Object.assign(row, patch);
        return respondUrls(call, matched);
      }
      if (call.method === 'DELETE') {
        db.urls = db.urls.filter((row) => !matched.includes(row));
        const wantsRows = (call.headers.get('prefer') || '').includes('return=representation');
        return wantsRows ? respondUrls(call, matched) : new Response(null, { status: 204 });
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

/** 公開轉址（不帶 Authorization） */
async function redirect(env: Bindings, shortCode: string) {
  const { res, settle } = await workerRequest(`/s/${shortCode}`, { redirect: 'manual' }, env);
  await settle();
  await res.body?.cancel();
  return res;
}

const callsTo = (calls: SupabaseCall[], pathname: string) =>
  calls.filter((call) => call.url.pathname === pathname);

const rpcBody = (calls: SupabaseCall[], name: string) => {
  const rpc = callsTo(calls, `/rest/v1/rpc/${name}`);
  expect(rpc).toHaveLength(1);
  return JSON.parse(rpc[0].body || '{}');
};

beforeEach(() => {
  // 稽核、錯誤記錄不輸出到測試結果
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 建立
// ============================================================

test('POST /api/urls（金鑰）→ 201：created_by = 負責同仁、api_key_id = 金鑰，帶 x-tcurl-api-key-id；short_url 用請求網域', async () => {
  const { db, calls } = mockDb();
  const env = createTestEnv({ BASE_URL: undefined });

  const res = await send(env, 'https://url.tzuchi.org/api/urls', {
    method: 'POST',
    body: { original_url: 'https://example.org/signup' },
  });

  expect(res.status).toBe(201);
  const body = (await res.json()) as Row;
  expect(body).toMatchObject({
    created_by: U,
    api_key_id: K,
    original_url: 'https://example.org/signup',
  });
  expect(body.short_url).toBe(`https://url.tzuchi.org/s/${body.short_code}`);

  const inserts = callsTo(calls, '/rest/v1/urls').filter((call) => call.method === 'POST');
  expect(inserts).toHaveLength(1);
  expect(JSON.parse(inserts[0].body || '{}')).toEqual({
    short_code: body.short_code,
    original_url: 'https://example.org/signup',
    created_by: U,
    api_key_id: K,
  });
  expect(isServiceRole(inserts[0])).toBe(true);
  expect(inserts[0].headers.get('x-tcurl-api-key-id')).toBe(K);
  expect(db.urls).toHaveLength(5);
});

// ============================================================
// 只碰得到這把金鑰的短網址
// ============================================================

test('GET /api/urls/:a（金鑰）→ 200，附上金鑰名稱與是否已撤銷', async () => {
  const { db } = mockDb();

  const res = await send(createTestEnv(), `/api/urls/${ID.a}`);

  expect(res.status).toBe(200);
  // 金鑰呼叫者不會收到 password_hash、updated_by（見下方「回應欄位」）
  const { password_hash: _hash, updated_by: _updatedBy, ...visible } = db.urls[0];
  expect(await res.json()).toEqual({
    ...visible,
    api_key_name: '報名系統',
    api_key_revoked: false,
  });
});

// ============================================================
// 金鑰呼叫者的回應欄位 = openapi 的 UrlRecord，不含 password_hash
// （負責同仁在網頁上替金鑰的短網址設了人工密碼時，外部服務不能拿到 bcrypt 雜湊離線破解）
// ============================================================

const OPENAPI_FILES = import.meta.glob<string>('../public/docs/openapi.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** openapi.yaml 的 components.schemas.UrlRecord 屬性名稱（手寫、固定 2 格縮排，逐行掃描） */
function urlRecordProperties(): string[] {
  const yaml = OPENAPI_FILES['../public/docs/openapi.yaml'];
  if (yaml === undefined) throw new Error('missing fixture: docs/openapi.yaml');
  const lines = yaml.split('\n');
  const start = lines.indexOf('    UrlRecord:');
  if (start === -1) throw new Error('openapi.yaml: UrlRecord not found');
  const props: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {0,4}\S/.test(line)) break; // 下一個 schema
    const prop = line.match(/^ {8}(\w+):\s*$/);
    if (prop) props.push(prop[1]);
  }
  return props;
}

/** 只有 GET /api/urls/:id 會附上的金鑰標示（withApiKeyInfo） */
const KEY_LABELS = ['api_key_name', 'api_key_revoked'];
const UNLABELED_FIELDS = () => urlRecordProperties().filter((prop) => !KEY_LABELS.includes(prop));
/** 負責同仁在網頁上替 a 設的人工密碼（bcrypt） */
const OWNER_SET_HASH = '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012';

const sortedKeys = (body: unknown) => Object.keys(body as Row).sort();

/** 金鑰請求對 urls 的 select：列出明確欄位，不是 `*`，也不含 password_hash */
function expectNoHashSelected(calls: SupabaseCall[]) {
  const accesses = callsTo(calls, '/rest/v1/urls');
  expect(accesses.length).toBeGreaterThan(0);
  for (const call of accesses) {
    const select = call.url.searchParams.get('select') ?? '';
    expect(select, `${call.method} ${call.url}`).not.toBe('');
    expect(select.split(','), `${call.method} ${call.url}`).not.toContain('*');
    expect(select, `${call.method} ${call.url}`).not.toContain('password_hash');
  }
}

test('UrlRecord 的欄位掃描有效（含 id、金鑰標示，不含 password_hash）', () => {
  const props = urlRecordProperties();
  expect(props).toContain('id');
  expect(props).toContain('api_key_id');
  expect(props).toEqual(expect.arrayContaining(KEY_LABELS));
  expect(props).not.toContain('password_hash');
});

test('GET /api/urls/:a（金鑰；設了人工密碼）→ 欄位 = UrlRecord，不含 password_hash', async () => {
  const { db, calls } = mockDb();
  Object.assign(db.urls[0], { password_protected: true, password_hash: OWNER_SET_HASH });

  const res = await send(createTestEnv(), `/api/urls/${ID.a}`);

  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).not.toContain(OWNER_SET_HASH);
  const body = JSON.parse(text);
  expect(body).toMatchObject({ id: ID.a, password_protected: true });
  expect(sortedKeys(body)).toEqual(urlRecordProperties().sort());
  expectNoHashSelected(calls);
});

test('POST /api/urls（金鑰）→ 欄位 = UrlRecord（不含金鑰標示）+ short_url，不含 password_hash', async () => {
  const { calls } = mockDb();

  const res = await send(createTestEnv(), '/api/urls', {
    method: 'POST',
    body: { original_url: 'https://example.org/signup' },
  });

  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body).toMatchObject({ created_by: U, api_key_id: K });
  expect(sortedKeys(body)).toEqual([...UNLABELED_FIELDS(), 'short_url'].sort());
  expectNoHashSelected(calls);
});

test('PUT /api/urls/:a（金鑰）設定密碼 → 寫入 bcrypt 雜湊，回應欄位 = UrlRecord（不含金鑰標示），不含雜湊', async () => {
  const { db, calls } = mockDb();

  const res = await send(createTestEnv(), `/api/urls/${ID.a}`, {
    method: 'PUT',
    body: { password: 'new-secret' },
  });

  expect(res.status).toBe(200);
  const text = await res.text();
  const stored = String(db.urls[0].password_hash);
  expect(stored).toMatch(/^\$2[aby]\$10\$/);
  expect(text).not.toContain(stored);
  const body = JSON.parse(text);
  expect(body).toMatchObject({ id: ID.a, password_protected: true });
  expect(sortedKeys(body)).toEqual(UNLABELED_FIELDS().sort());
  expectNoHashSelected(calls);
});

test('使用者 JWT 的 GET/POST/PUT /api/urls* 照舊回整列（select=*）', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  const requests: Array<[number, string, string, unknown, string[]]> = [
    [201, 'POST', '/api/urls', { original_url: 'https://example.org/web' }, ['short_url']],
    [200, 'GET', `/api/urls/${ID.m}`, undefined, []],
    [200, 'PUT', `/api/urls/${ID.m}`, { is_active: false }, []],
  ];
  for (const [status, method, path, body, extra] of requests) {
    const res = await send(env, path, { method, body, token: USER_JWT });
    expect(res.status, `${method} ${path}`).toBe(status);
    expect(sortedKeys(await res.json()), `${method} ${path}`).toEqual(
      [...URL_COLUMNS, ...extra].sort(),
    );
  }

  const accesses = callsTo(calls, '/rest/v1/urls');
  expect(accesses).toHaveLength(3);
  for (const call of accesses) {
    expect(call.url.searchParams.get('select'), `${call.method} ${call.url}`).toBe('*');
  }
});

const NOT_THIS_KEY: Array<[string, string]> = [
  ['m（負責同仁手動建立）', ID.m],
  ['b（同一位同仁的另一把金鑰）', ID.b],
  ['x（別人的，api_key_id 被錯設成 K）', ID.x],
  ['abc（非 UUID）', 'abc'],
];

const ID_ENDPOINTS: Array<[string, string, (id: string) => string, unknown]> = [
  ['GET /api/urls/:id', 'GET', (id) => `/api/urls/${id}`, undefined],
  [
    'PUT /api/urls/:id',
    'PUT',
    (id) => `/api/urls/${id}`,
    { is_active: false, original_url: 'https://example.net/hijacked' },
  ],
  [
    'PATCH /api/urls/:id/qr-code',
    'PATCH',
    (id) => `/api/urls/${id}/qr-code`,
    { qr_code_options: { dotsColor: '#ff0000' } },
  ],
  ['DELETE /api/urls/:id', 'DELETE', (id) => `/api/urls/${id}`, undefined],
  ['GET /api/urls/:id/stats', 'GET', (id) => `/api/urls/${id}/stats`, undefined],
];

test.each(
  ID_ENDPOINTS.flatMap(([label, method, path, body]) =>
    NOT_THIS_KEY.map(([name, id]) => [label, name, method, path(id), body] as const),
  ),
)('%s（金鑰）對 %s → 404，資料不變、不呼叫 get_url_stats', async (_label, _name, method, path, body) => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.urls);

  const res = await send(createTestEnv(), path, { method, body });

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'URL not found' });
  expect(db.urls).toEqual(before);
  expect(callsTo(calls, '/rest/v1/rpc/get_url_stats')).toHaveLength(0);
});

test('PUT /api/urls/:a（金鑰）→ 200，並清除轉址快取（停用後下一次轉址立即 404）', async () => {
  const { db } = mockDb();
  const env = createTestEnv();
  expect((await redirect(env, 'keyA01')).status).toBe(302);

  const res = await send(env, `/api/urls/${ID.a}`, { method: 'PUT', body: { is_active: false } });

  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ id: ID.a, is_active: false });
  expect(db.urls.find((row) => row.id === ID.a)?.is_active).toBe(false);
  expect((await redirect(env, 'keyA01')).status).toBe(404);
});

test('DELETE /api/urls/:b（金鑰）→ 404；DELETE /api/urls/:a → 200，並清除轉址快取', async () => {
  const { db } = mockDb();
  const env = createTestEnv();
  expect((await redirect(env, 'keyA01')).status).toBe(302);

  const other = await send(env, `/api/urls/${ID.b}`, { method: 'DELETE' });
  expect(other.status).toBe(404);
  await other.body?.cancel();

  const own = await send(env, `/api/urls/${ID.a}`, { method: 'DELETE' });
  expect(own.status).toBe(200);
  expect(await own.json()).toEqual({ message: 'URL deleted successfully' });

  expect(db.urls.map((row) => row.id)).toEqual([ID.m, ID.b, ID.x]);
  expect((await redirect(env, 'keyA01')).status).toBe(404);
});

/** 網頁「客製化 QR Code」實際送出的形狀（public/js/edit.js applyCustomQR） */
const VALID_QR_OPTIONS = {
  dotsColor: '#713d3d',
  bgColor: '#ffffff',
  bgOpacity: 100,
  dotsType: 'rounded',
  cornersSquareType: 'square',
  cornersDotType: 'square',
  showLogo: true,
};

test('PATCH /api/urls/:a/qr-code（金鑰）→ 200，只改 a', async () => {
  const { db } = mockDb();
  const qrOptions = VALID_QR_OPTIONS;

  const res = await send(createTestEnv(), `/api/urls/${ID.a}/qr-code`, {
    method: 'PATCH',
    body: { qr_code_options: qrOptions },
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    success: true,
    qr_code_path: null,
    qr_code_options: qrOptions,
  });
  expect(db.urls.map((row) => row.qr_code_options)).toEqual([qrOptions, null, null, null]);
});

// 金鑰寫入的 qr_code_options 會在負責同仁的編輯頁放進 HTML（public/js/edit.js 的客製化對話框），
// 寫入者與觀看者不同人：後端只接受已知的鍵與格式（spec §4 反目標 1）
test.each([
  ['dotsColor 夾帶 HTML', { dotsColor: '"><img src=x onerror=alert(document.domain)>' }],
  ['bgColor 夾帶 HTML', { bgColor: '#fff" autofocus onfocus="alert(1)' }],
  ['未知的鍵', { ...VALID_QR_OPTIONS, image: 'https://evil.example/x.svg' }],
  ['dotsColor 是陣列', { dotsColor: ['"><img src=x onerror=alert(1)>'] }],
  ['dotsType 不在選項內', { dotsType: '<script>' }],
  ['bgOpacity 超過 100', { bgOpacity: 101 }],
  ['showLogo 不是布林', { showLogo: 'true' }],
  ['qr_code_options 是陣列', [VALID_QR_OPTIONS]],
  ['qr_code_options 是字串', '"><img src=x onerror=alert(1)>'],
])('PATCH /api/urls/:a/qr-code（金鑰）%s → 400，資料不變', async (_label, qrOptions) => {
  const { db, calls } = mockDb();
  const before = structuredClone(db.urls);

  const res = await send(createTestEnv(), `/api/urls/${ID.a}/qr-code`, {
    method: 'PATCH',
    body: { qr_code_options: qrOptions },
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ error: 'Invalid qr_code_options' });
  expect(db.urls).toEqual(before);
  expect(callsTo(calls, '/rest/v1/urls')).toHaveLength(0);
});

// ============================================================
// 統計
// ============================================================

test('GET /api/urls（金鑰）→ get_urls_with_stats 只算這把金鑰', async () => {
  const { calls } = mockDb();

  const res = await send(createTestEnv(), '/api/urls');

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(RPC_RESULTS.get_urls_with_stats);
  expect(rpcBody(calls, 'get_urls_with_stats')).toEqual({
    p_user_id: U,
    p_page: 1,
    p_limit: 10,
    p_api_key_id: K,
  });
});

test('GET /api/urls/stats/summary、GET /api/stats/daily（金鑰）→ RPC 帶 p_user_id = 負責同仁、p_api_key_id = 金鑰', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  const summary = await send(env, '/api/urls/stats/summary');
  expect(summary.status).toBe(200);
  expect(await summary.json()).toEqual(RPC_RESULTS.get_stats_summary);

  const daily = await send(env, '/api/stats/daily?days=7');
  expect(daily.status).toBe(200);
  expect(await daily.json()).toEqual(RPC_RESULTS.get_daily_stats);

  expect(rpcBody(calls, 'get_stats_summary')).toEqual({ p_user_id: U, p_api_key_id: K });
  expect(rpcBody(calls, 'get_daily_stats')).toEqual({ p_user_id: U, p_days: 7, p_api_key_id: K });
});

test('GET /api/urls/:a/stats（金鑰）→ 200，先以兩個條件確認擁有權再呼叫 get_url_stats', async () => {
  const { calls } = mockDb();

  const res = await send(createTestEnv(), `/api/urls/${ID.a}/stats`);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(RPC_RESULTS.get_url_stats);
  expect(rpcBody(calls, 'get_url_stats')).toEqual({ p_url_id: ID.a, p_days: 30 });
});

// ============================================================
// 每個金鑰請求：service role + x-tcurl-api-key-id、兩個條件、不呼叫 Supabase Auth
// ============================================================

test('金鑰請求走遍所有短網址與統計端點：不呼叫 /auth/v1/user；urls 存取都帶兩個條件；完整金鑰不外流', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  const requests: Array<[number, string, string, unknown?]> = [
    [201, 'POST', '/api/urls', { original_url: 'https://example.org/new' }],
    [200, 'GET', '/api/urls'],
    [200, 'GET', '/api/urls/stats/summary'],
    [200, 'GET', '/api/stats/daily'],
    [404, 'GET', `/api/urls/${ID.m}`],
    [200, 'GET', `/api/urls/${ID.a}`],
    [404, 'GET', `/api/urls/${ID.m}/stats`],
    [200, 'GET', `/api/urls/${ID.a}/stats`],
    [404, 'PUT', `/api/urls/${ID.m}`, { is_active: false }],
    [200, 'PUT', `/api/urls/${ID.a}`, { original_url: 'https://example.org/changed' }],
    [404, 'PATCH', `/api/urls/${ID.m}/qr-code`, { qr_code_options: {} }],
    [200, 'PATCH', `/api/urls/${ID.a}/qr-code`, { qr_code_options: {} }],
    [404, 'DELETE', `/api/urls/${ID.m}`],
    [200, 'DELETE', `/api/urls/${ID.a}`],
  ];
  const responses: string[] = [];
  for (const [status, method, path, body] of requests) {
    const res = await send(env, path, { method, body });
    expect(res.status, `${method} ${path}`).toBe(status);
    responses.push(JSON.stringify([...res.headers]), await res.text());
  }

  expect(callsTo(calls, '/auth/v1/user')).toHaveLength(0);

  // 除了驗證金鑰的 RPC 與讀金鑰名稱，所有 Supabase 請求都經 getSupabaseForApiKey
  const routeCalls = calls.filter(
    (call) => !['/rest/v1/rpc/verify_api_key', '/rest/v1/api_keys'].includes(call.url.pathname),
  );
  for (const call of routeCalls) {
    expect(isServiceRole(call), `${call.method} ${call.url}`).toBe(true);
    expect(call.headers.get('x-tcurl-api-key-id'), `${call.method} ${call.url}`).toBe(K);
  }

  // GET/PUT/PATCH/DELETE 共 12 次 urls 存取（PATCH、DELETE 成功時各兩次），每次都帶兩個條件
  const urlAccess = callsTo(calls, '/rest/v1/urls').filter((call) => call.method !== 'POST');
  expect(urlAccess).toHaveLength(12);
  for (const call of urlAccess) {
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

test('使用者 JWT 打 GET /api/urls/:id：金鑰建立的附上 api_key_name、api_key_revoked；手動建立的不附加', async () => {
  const { db, calls } = mockDb();
  const env = createTestEnv();

  const a = await send(env, `/api/urls/${ID.a}`, { token: USER_JWT });
  expect(a.status).toBe(200);
  expect(await a.json()).toEqual({ ...db.urls[0], api_key_name: '報名系統', api_key_revoked: false });

  const b = await send(env, `/api/urls/${ID.b}`, { token: USER_JWT });
  expect(b.status).toBe(200);
  expect(await b.json()).toEqual({ ...db.urls[2], api_key_name: '舊報名系統', api_key_revoked: true });

  const m = await send(env, `/api/urls/${ID.m}`, { token: USER_JWT });
  expect(m.status).toBe(200);
  expect(await m.json()).toEqual(db.urls[1]);

  // 讀 urls 走 user client（RLS）；api_keys 前端讀不到，一律以 service role 查
  for (const call of callsTo(calls, '/rest/v1/urls')) {
    expect(call.headers.get('apikey')).toBe(ANON_KEY);
    expect(call.url.searchParams.has('api_key_id')).toBe(false);
  }
  const keyLookups = callsTo(calls, '/rest/v1/api_keys');
  expect(keyLookups).toHaveLength(2);
  for (const call of keyLookups) expect(isServiceRole(call)).toBe(true);
});

test('使用者 JWT 的統計 RPC 參數與以前相同（不帶 p_api_key_id）', async () => {
  const { calls } = mockDb();
  const env = createTestEnv();

  for (const path of ['/api/urls', '/api/urls/stats/summary', '/api/stats/daily']) {
    const res = await send(env, path, { token: USER_JWT });
    expect(res.status, path).toBe(200);
    await res.body?.cancel();
  }

  expect(rpcBody(calls, 'get_urls_with_stats')).toEqual({ p_user_id: U, p_page: 1, p_limit: 10 });
  expect(rpcBody(calls, 'get_stats_summary')).toEqual({ p_user_id: U });
  expect(rpcBody(calls, 'get_daily_stats')).toEqual({ p_user_id: U, p_days: 30 });
});
