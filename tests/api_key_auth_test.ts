/**
 * 服務 API 金鑰中介層（src/middleware/api-key-auth.ts；spec §6.3–§6.5、§6.8）
 *
 * - 只處理 /api/* 且 Authorization 含 tcurl_sk_ 的請求；不是 Bearer tcurl_sk_…（scheme 不分大小寫）的寫法
 *   一律 401（reason malformed_header），不交給 JWT 流程、不送任何請求到 Supabase；
 *   extractToken 遇到含 tcurl_sk_ 的 token 也回 null（第二道防線）
 * - 白名單守門：app 實際註冊、會被 matchApiKeyRoute 放行的路由都逐字列在 API_KEY_ROUTES
 * - 驗證前先以 IP 扣寬鬆的前置限流（API_KEY_VERIFY_RATE_LIMITER）：超過回 429、不查資料庫，
 *   同一個 IP 不能無上限地觸發 verify_api_key（spec §6.5「避免灌爆資料庫查詢」）
 * - 格式不符的金鑰不查資料庫（reason malformed）
 * - 無效金鑰：先記錄失敗原因與雜湊開頭，再計入 IP 限流（RATE_LIMITER），回 401（訊息不區分原因）或 429
 * - 驗證服務本身出錯：503 + Retry-After，不扣 IP 額度、不記為無效金鑰
 * - 有效金鑰：先每把金鑰各自限流（API_KEY_RATE_LIMITER，不吃 IP 限流；被拒的請求也計入），
 *   再檢查端點白名單（不在白名單 → 401）與權限（不足 → 403）
 * - 稽核紀錄頂層帶 apiKeyId；回應與記錄都不得出現完整金鑰
 */

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import app from '../src/main.ts';
import { API_KEY_ROUTES, apiKeyAuth, matchApiKeyRoute } from '../src/middleware/api-key-auth.ts';
import { getApiKey, scopeToApiKey } from '../src/routes/_helpers.ts';
import { adminRoutes } from '../src/routes/admin.ts';
import { authRoutes } from '../src/routes/auth.ts';
import { urlChannelRoutes } from '../src/routes/url-channels.ts';
import { urlCrudRoutes } from '../src/routes/url-crud.ts';
import { urlStatsRoutes } from '../src/routes/url-stats.ts';
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  type ApiKeyPrincipal,
} from '../src/services/api-keys.ts';
import { extractToken, getSupabase, getSupabaseForApiKey } from '../src/services/supabase.ts';
import type { AppEnv } from '../src/types/env.ts';
import {
  createRateLimiter,
  createTestEnv,
  jsonResponse,
  mockSupabaseFetch,
  workerRequest,
} from './helpers/test-env.ts';

const RPC_PATH = '/rest/v1/rpc/verify_api_key';
const KEY = 'tcurl_sk_Zx9Qw3Er5Ty7Ui1Op0As2Df4Gh6Jk8LzXcVbNm-_Q1w';
const KEY_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const IP = '203.0.113.7';
const INVALID_KEY_BODY = { error: 'Unauthorized', message: 'API 金鑰無效或已失效' };
const FORBIDDEN_BODY = { error: 'Forbidden', message: '此 API 金鑰沒有此操作的權限' };

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';
let consoleSpies: Record<ConsoleMethod, ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  // 攔下所有 console 輸出：保持測試輸出乾淨，並用來檢查記錄內容
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

// ============================================================
// 測試替身
// ============================================================

function okRpc(scopes: string[] = ['read', 'write']) {
  return { status: 'ok', key_id: KEY_ID, name: 'svc', owner_id: OWNER_ID, scopes };
}

/** verify_api_key RPC 回傳指定內容；其他 Supabase 請求走預設（401） */
function mockVerify(rpcBody: Record<string, unknown>) {
  return mockSupabaseFetch((call) =>
    call.method === 'POST' && call.url.pathname === RPC_PATH ? jsonResponse(rpcBody) : undefined,
  );
}

function rpcCalls(calls: { url: URL }[]) {
  return calls.filter((call) => call.url.pathname === RPC_PATH);
}

function setup(
  opts: { ip?: boolean; key?: boolean; verify?: boolean; overrides?: Partial<AppEnv['Bindings']> } = {},
) {
  const ipLimiter = createRateLimiter(opts.ip ?? true);
  const keyLimiter = createRateLimiter(opts.key ?? true);
  const verifyLimiter = createRateLimiter(opts.verify ?? true);
  const env = createTestEnv({
    RATE_LIMITER: ipLimiter as unknown as RateLimit,
    API_KEY_RATE_LIMITER: keyLimiter as unknown as RateLimit,
    API_KEY_VERIFY_RATE_LIMITER: verifyLimiter as unknown as RateLimit,
    ...opts.overrides,
  });
  return { ipLimiter, keyLimiter, verifyLimiter, env };
}

/** 依鍵計數的假限流器：同一個鍵第 limit + 1 次起回 success:false（同 Rate Limiting binding 的時間窗內） */
function countingLimiter(limit: number) {
  const counts = new Map<string, number>();
  return {
    limit: vi.fn(async ({ key }: { key: string }) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    }),
  };
}

function keyInit(method = 'GET', authorization = `Bearer ${KEY}`): RequestInit {
  return { method, headers: { Authorization: authorization, 'CF-Connecting-IP': IP } };
}

/** 只掛 apiKeyAuth 的小 app：handler 回傳 getApiKey(c)，用來確認中介層放行並設定呼叫者 */
function isolatedApp() {
  const app = new Hono<AppEnv>();
  app.use('*', apiKeyAuth());
  app.all('/api/*', (c) => c.json({ apiKey: getApiKey(c) ?? null }));
  return app;
}

/** 從 console 攔截紀錄中依時間順序取出 [AUDIT] 稽核紀錄（成功走 info、失敗走 warn） */
function auditEntries(): Record<string, unknown>[] {
  return Object.values(consoleSpies)
    .flatMap((spy) =>
      spy.mock.calls.map((args, i) => ({ order: spy.mock.invocationCallOrder[i], line: args[0] })),
    )
    .sort((a, b) => a.order - b.order)
    .map(({ line }) => line)
    .filter((line): line is string => typeof line === 'string' && line.startsWith('[AUDIT] '))
    .map((line) => JSON.parse(line.slice('[AUDIT] '.length)));
}

// ============================================================
// 端點白名單（spec §6.3）
// ============================================================

describe('matchApiKeyRoute', () => {
  test.each([
    ['GET', '/api/urls', 'read'],
    ['GET', '/api/urls/stats/summary', 'read'],
    ['GET', '/api/stats/daily', 'read'],
    ['GET', '/api/urls/abc', 'read'],
    ['GET', '/api/urls/abc/stats', 'read'],
    ['GET', '/api/urls/abc/channels', 'read'],
    ['POST', '/api/urls', 'write'],
    ['PUT', '/api/urls/abc', 'write'],
    ['DELETE', '/api/urls/abc', 'write'],
    ['PATCH', '/api/urls/abc/qr-code', 'write'],
    ['POST', '/api/urls/abc/channels', 'write'],
    ['PUT', '/api/urls/abc/channels/ch1', 'write'],
    ['DELETE', '/api/urls/abc/channels/ch1', 'write'],
  ])('%s %s → %s', (method, path, scope) => {
    expect(matchApiKeyRoute(method, path)).toBe(scope);
  });

  test.each([
    ['GET', '/api/admin/stats'],
    ['GET', '/api/auth/me'],
    ['GET', '/api/feedbacks'],
    ['POST', '/api/urls/abc/verify-password'],
    ['GET', '/api/urls/abc/channels/extra/x'],
    // 白名單以外的方法、空的路徑參數、尾斜線、管理者的金鑰 API 都不放行
    ['PATCH', '/api/urls/abc'],
    ['POST', '/api/urls/abc/channels/ch1'],
    ['GET', '/api/urls/'],
    ['GET', '/api/urls//stats'],
    ['GET', '/api/admin/api-keys'],
    ['GET', '/api/version'],
  ])('%s %s → null', (method, path) => {
    expect(matchApiKeyRoute(method, path)).toBeNull();
  });
});

// ============================================================
// 白名單守門：實際註冊的路由 ↔ API_KEY_ROUTES（spec §6.3「新端點預設拒絕金鑰」）
// matchApiKeyRoute 只比對路徑形狀：日後新增 GET /api/urls/export 這類同形狀的路由，
// 會被當成 GET /api/urls/:id 自動放行。這裡要求放行的路由都逐字列在白名單裡。
// ============================================================

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * 白名單與實際路由的落差（回傳說明文字；沒有落差回空陣列）：
 * - 會被 matchApiKeyRoute 放行、卻沒有逐字列在 API_KEY_ROUTES 的路由
 * - API_KEY_ROUTES 裡沒有對應路由的項目
 * method 為 ALL（app.all、use）時逐一檢查每個方法；路徑含 `*` 的 ALL 是中介層（例如 `use('*')`），略過。
 */
function whitelistDrift(routes: { method: string; path: string }[]): string[] {
  const registered = new Set<string>();
  for (const { method, path } of routes) {
    if (method !== 'ALL') registered.add(`${method} ${path}`);
    else if (!path.includes('*')) HTTP_METHODS.forEach((m) => registered.add(`${m} ${path}`));
  }
  const whitelist = new Set(API_KEY_ROUTES.map((r) => `${r.method} ${r.path}`));
  const drift: string[] = [];
  for (const route of registered) {
    const [method, path] = route.split(' ');
    if (matchApiKeyRoute(method, path) && !whitelist.has(route)) drift.push(`會放行但不在白名單：${route}`);
  }
  for (const route of whitelist) {
    if (!registered.has(route)) drift.push(`白名單沒有對應的路由：${route}`);
  }
  return drift;
}

describe('白名單守門（src/main.ts 的 app.routes）', () => {
  test('金鑰會被放行的路由，都逐字列在 API_KEY_ROUTES；API_KEY_ROUTES 的每一條都有路由', () => {
    expect(app.routes.length).toBeGreaterThan(API_KEY_ROUTES.length);
    expect(whitelistDrift(app.routes)).toEqual([]);
  });

  test('守門本身：抓得到同形狀的新路由、參數名稱不同、app.all，以及多出來的白名單項目；中介層不誤報', () => {
    const extra = new Hono<AppEnv>();
    extra.use('/api/urls/*', async (_c, next) => next());
    extra.get('/api/urls/export', (c) => c.text(''));
    extra.get('/api/urls/:shortCode/stats', (c) => c.text(''));
    extra.all('/api/urls/:urlId', (c) => c.text(''));
    const routes = [
      ...app.routes.filter(
        (r) => !(r.method === 'DELETE' && r.path === '/api/urls/:id/channels/:channelId'),
      ),
      ...extra.routes,
    ];

    expect(whitelistDrift(routes).sort()).toEqual(
      [
        '會放行但不在白名單：GET /api/urls/export',
        '會放行但不在白名單：GET /api/urls/:shortCode/stats',
        '會放行但不在白名單：GET /api/urls/:urlId',
        '會放行但不在白名單：PUT /api/urls/:urlId',
        '會放行但不在白名單：DELETE /api/urls/:urlId',
        '白名單沒有對應的路由：DELETE /api/urls/:id/channels/:channelId',
      ].sort(),
    );
  });
});

// ============================================================
// 無效金鑰：401 並計入 IP 限流
// ============================================================

test('無效金鑰 → 401 API 金鑰無效或已失效；以 IP 呼叫 RATE_LIMITER 一次；不呼叫 API_KEY_RATE_LIMITER', async () => {
  mockVerify({ status: 'not_found' });
  const { ipLimiter, keyLimiter, env } = setup();

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual(INVALID_KEY_BODY);
  expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
  expect(ipLimiter.limit).toHaveBeenCalledWith({ key: IP });
  expect(keyLimiter.limit).not.toHaveBeenCalled();
});

/** verify 的每一種失敗原因（malformed 是格式不符，不查 RPC） */
const VERIFY_FAILURES: [reason: string, token: string, rpcStatus: string | null][] = [
  ['not_found', KEY, 'not_found'],
  ['revoked', KEY, 'revoked'],
  ['expired', KEY, 'expired'],
  ['owner_missing', KEY, 'owner_missing'],
  ['owner_banned', KEY, 'owner_banned'],
  ['malformed', 'tcurl_sk_short', null],
];

test.each(VERIFY_FAILURES)(
  'verify 失敗（%s）→ 401，回應與其他原因完全相同、不含金鑰；伺服器記錄分得出原因',
  async (reason, token, rpcStatus) => {
    const { calls } = mockVerify(rpcStatus ? { status: rpcStatus } : okRpc());
    const { env } = setup();

    const { res } = await workerRequest('/api/urls', keyInit('GET', `Bearer ${token}`), env);

    expect(res.status).toBe(401);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual(INVALID_KEY_BODY);
    expect(body + JSON.stringify([...res.headers])).not.toContain(token);
    expect(rpcCalls(calls)).toHaveLength(rpcStatus ? 1 : 0);
    expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
      reason,
      hashPrefix: (await hashApiKey(token)).slice(0, 8),
    });
  },
);

test('無效金鑰 → 伺服器記錄失敗原因與雜湊開頭（不記原文）', async () => {
  mockVerify({ status: 'revoked' });
  const { env } = setup();

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(401);
  expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
    reason: 'revoked',
    hashPrefix: (await hashApiKey(KEY)).slice(0, 8),
  });
});

/** 驗證服務本身出錯的三種情況：RPC 回錯誤、回傳無法辨識的內容、連線失敗 */
const VERIFY_ERRORS: [string, () => void][] = [
  [
    'RPC 回錯誤',
    () =>
      mockSupabaseFetch((call) =>
        call.url.pathname === RPC_PATH ? jsonResponse({ code: 'XX000', message: 'boom' }, 500) : undefined,
      ),
  ],
  ['RPC 回傳無法辨識的內容', () => mockVerify({ status: 'weird' })],
  [
    '連線失敗',
    () =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      ),
  ],
];

test.each(VERIFY_ERRORS)(
  '驗證服務出錯（%s）→ 503 + Retry-After（不是 401）；不扣 IP 額度、不記為無效金鑰',
  async (_label, mock) => {
    mock();
    const { ipLimiter, keyLimiter, env } = setup();

    const { res } = await workerRequest('/api/urls', keyInit(), env);

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
    expect(await res.json()).toEqual({
      error: 'Service Unavailable',
      message: '暫時無法驗證 API 金鑰，請稍後重試',
    });
    expect(ipLimiter.limit).not.toHaveBeenCalled();
    expect(keyLimiter.limit).not.toHaveBeenCalled();
    expect(consoleSpies.warn).not.toHaveBeenCalledWith('[ApiKey] verify failed', expect.anything());
    // 錯誤本身由 services/api-keys.ts 記錄
    expect(consoleSpies.error).toHaveBeenCalled();
  },
);

test('驗證服務出錯 → 503，不呼叫 next()（路由不會執行）', async () => {
  mockSupabaseFetch((call) =>
    call.url.pathname === RPC_PATH ? jsonResponse({ code: 'XX000', message: 'boom' }, 500) : undefined,
  );
  const { env } = setup();

  const res = await isolatedApp().request('/api/urls', keyInit(), env);

  expect(res.status).toBe(503);
});

test('無效金鑰且 IP 限流已滿 → 429（JSON，與一般限流格式相同）', async () => {
  mockVerify({ status: 'not_found' });
  const { env } = setup({ ip: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);
  expect(res.status).toBe(429);
  const body = await res.json();

  // 一般限流（main.ts）的 429 回應
  const general = await workerRequest('/api/version', {}, env);
  expect(general.res.status).toBe(429);
  expect(body).toEqual(await general.res.json());
});

test('無效金鑰且 IP 限流已滿 → 429，仍記錄失敗原因與雜湊開頭（暴力嘗試期間也留下紀錄）', async () => {
  mockVerify({ status: 'revoked' });
  const { env } = setup({ ip: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(429);
  await res.body?.cancel();
  expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
    reason: 'revoked',
    hashPrefix: (await hashApiKey(KEY)).slice(0, 8),
  });
});

test('格式不符的金鑰 → 401，不呼叫 verify_api_key；照樣計入 IP 限流並記錄 reason malformed', async () => {
  const { calls } = mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup();
  const malformed = 'tcurl_sk_short';

  const { res } = await workerRequest('/api/urls', keyInit('GET', `Bearer ${malformed}`), env);

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual(INVALID_KEY_BODY);
  expect(rpcCalls(calls)).toHaveLength(0);
  expect(ipLimiter.limit).toHaveBeenCalledWith({ key: IP });
  expect(keyLimiter.limit).not.toHaveBeenCalled();
  expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
    reason: 'malformed',
    hashPrefix: (await hashApiKey(malformed)).slice(0, 8),
  });
});

// ============================================================
// 驗證前的每 IP 前置限流（spec §6.5：避免用亂造的金鑰灌爆資料庫查詢）
// ============================================================

test('帶金鑰的請求（有效、無效都算）在驗證前以 IP 呼叫 API_KEY_VERIFY_RATE_LIMITER 一次；JWT 請求不呼叫', async () => {
  mockVerify(okRpc());
  const valid = setup();
  const validRes = await workerRequest('/api/urls', keyInit(), valid.env);
  await validRes.res.body?.cancel();
  expect(valid.verifyLimiter.limit).toHaveBeenCalledTimes(1);
  expect(valid.verifyLimiter.limit).toHaveBeenCalledWith({ key: IP });

  mockVerify({ status: 'not_found' });
  const invalid = setup();
  const invalidRes = await workerRequest('/api/urls', keyInit(), invalid.env);
  expect(invalidRes.res.status).toBe(401);
  await invalidRes.res.body?.cancel();
  expect(invalid.verifyLimiter.limit).toHaveBeenCalledTimes(1);
  expect(invalid.verifyLimiter.limit).toHaveBeenCalledWith({ key: IP });

  const jwt = setup();
  const jwtRes = await workerRequest('/api/urls', keyInit('GET', 'Bearer eyJ.x.y'), jwt.env);
  await jwtRes.res.body?.cancel();
  expect(jwt.verifyLimiter.limit).not.toHaveBeenCalled();
});

test('IP 的金鑰驗證次數已滿 → 429，不呼叫 verify_api_key，不扣 RATE_LIMITER／API_KEY_RATE_LIMITER；記錄原因', async () => {
  const { calls } = mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup({ verify: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({
    statusCode: 429,
    error: 'Too Many Requests',
    message: '請求過於頻繁，請在 60 秒後重試',
  });
  expect(calls).toHaveLength(0);
  expect(ipLimiter.limit).not.toHaveBeenCalled();
  expect(keyLimiter.limit).not.toHaveBeenCalled();
  expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
    reason: 'verify_rate_limited',
    hashPrefix: (await hashApiKey(KEY)).slice(0, 8),
  });
});

test('同一個 IP 連續送亂造的金鑰：IP 限流滿了之後，verify_api_key 呼叫次數不超過前置上限', async () => {
  const { calls } = mockVerify({ status: 'not_found' });
  const env = createTestEnv({
    RATE_LIMITER: countingLimiter(3) as unknown as RateLimit,
    API_KEY_VERIFY_RATE_LIMITER: countingLimiter(5) as unknown as RateLimit,
  });

  const statuses: number[] = [];
  for (let i = 0; i < 12; i++) {
    const { key } = await generateApiKey();
    const { res } = await workerRequest('/api/urls', keyInit('GET', `Bearer ${key}`), env);
    statuses.push(res.status);
    await res.body?.cancel();
  }

  // 前 3 個 401；第 4、5 個查過 DB 後因 IP 限流 429；之後在查 DB 之前就 429
  expect(statuses).toEqual([401, 401, 401, 429, 429, 429, 429, 429, 429, 429, 429, 429]);
  expect(rpcCalls(calls)).toHaveLength(5);
});

test('有效金鑰但同一個 IP 的金鑰驗證次數已滿 → 429（前置上限遠高於每把金鑰的上限，只擋異常流量）', async () => {
  const { calls } = mockVerify(okRpc());
  const { keyLimiter, env } = setup({ verify: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(429);
  await res.body?.cancel();
  expect(calls).toHaveLength(0);
  expect(keyLimiter.limit).not.toHaveBeenCalled();
});

test('API_KEY_VERIFY_RATE_LIMITER 異常 → 放行（fail-open，同一般限流）', async () => {
  mockVerify(okRpc());
  const env = createTestEnv({
    API_KEY_VERIFY_RATE_LIMITER: {
      limit: async () => {
        throw new Error('limiter down');
      },
    } as unknown as RateLimit,
  });

  const res = await isolatedApp().request('/api/urls', keyInit(), env);

  expect(res.status).toBe(200);
  expect(((await res.json()) as { apiKey: ApiKeyPrincipal }).apiKey.keyId).toBe(KEY_ID);
});

// ============================================================
// 有效金鑰：白名單、權限
// ============================================================

for (const path of ['/api/admin/stats', '/api/auth/me', '/api/feedbacks']) {
  test(`有效金鑰打 GET ${path} → 401，路由不會執行；仍計入該金鑰的限流`, async () => {
    const { calls } = mockVerify(okRpc());
    const { ipLimiter, keyLimiter, env } = setup();

    const { res } = await workerRequest(path, keyInit(), env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID_KEY_BODY);
    // 只有驗證 RPC，沒有任何路由的資料庫存取
    expect(calls).toHaveLength(1);
    expect(rpcCalls(calls)).toHaveLength(1);
    // 被拒的有效金鑰請求也要受限流（spec §6.5），否則可以無上限地觸發驗證 RPC
    expect(keyLimiter.limit).toHaveBeenCalledTimes(1);
    expect(keyLimiter.limit).toHaveBeenCalledWith({ key: KEY_ID });
    expect(ipLimiter.limit).not.toHaveBeenCalled();
  });
}

// openapi info.description 與 llm.txt 的說明：/api/* 底下不需要登入的公開端點帶著金鑰也是 401；
// 轉址 /s/、廣告頁 /ad/ 不在 /api/* 底下，中介層不看 Authorization
test.each([
  ['POST', '/api/urls/abc/verify-password'],
  ['POST', '/api/ad/abc/view'],
  ['POST', '/api/ad/abc/click'],
  ['GET', '/api/rooms/items'],
  ['GET', '/api/version'],
])('有效金鑰打公開端點 %s %s → 401，路由不會執行', async (method, path) => {
  const { calls } = mockVerify(okRpc());
  const { env } = setup();

  const { res } = await workerRequest(path, keyInit(method), env);

  expect(res.status).toBe(401);
  expect(await res.json()).toEqual(INVALID_KEY_BODY);
  // 只有驗證 RPC，沒有任何路由的資料庫存取
  expect(calls).toHaveLength(1);
  expect(rpcCalls(calls)).toHaveLength(1);
});

test('轉址 /s/:shortCode 帶著金鑰：不驗證金鑰，照常走轉址流程（找不到 → 404 頁面）', async () => {
  const { calls } = mockVerify(okRpc());
  const { env } = setup();

  const { res } = await workerRequest('/s/abc', keyInit(), env);

  expect(res.status).toBe(404);
  expect(rpcCalls(calls)).toEqual([]);
});

/** 只有 read 的金鑰打 POST /api/urls（權限不足） */
function postUrl(env: AppEnv['Bindings']) {
  return workerRequest(
    '/api/urls',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KEY}`,
        'CF-Connecting-IP': IP,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ original_url: 'https://example.com' }),
    },
    env,
  );
}

test('只有 read 的金鑰打 POST /api/urls → 403，路由不會執行；仍計入該金鑰的限流', async () => {
  const { calls } = mockVerify(okRpc(['read']));
  const { ipLimiter, keyLimiter, env } = setup();

  const { res } = await postUrl(env);

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual(FORBIDDEN_BODY);
  expect(calls).toHaveLength(1);
  expect(keyLimiter.limit).toHaveBeenCalledTimes(1);
  expect(keyLimiter.limit).toHaveBeenCalledWith({ key: KEY_ID });
  expect(ipLimiter.limit).not.toHaveBeenCalled();
});

test('金鑰限流已滿：有效金鑰打 GET /api/admin/stats（端點不允許）→ 429，不吃 IP 限流', async () => {
  const { calls } = mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup({ key: false });

  const { res } = await workerRequest('/api/admin/stats', keyInit(), env);

  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({
    statusCode: 429,
    error: 'Too Many Requests',
    message: '請求過於頻繁，請在 60 秒後重試',
  });
  expect(calls).toHaveLength(1);
  expect(keyLimiter.limit).toHaveBeenCalledWith({ key: KEY_ID });
  expect(ipLimiter.limit).not.toHaveBeenCalled();
});

test('金鑰限流已滿：只有 read 的金鑰打 POST /api/urls（權限不足）→ 429，不吃 IP 限流', async () => {
  const { calls } = mockVerify(okRpc(['read']));
  const { ipLimiter, keyLimiter, env } = setup({ key: false });

  const { res } = await postUrl(env);

  expect(res.status).toBe(429);
  expect(((await res.json()) as { statusCode: number }).statusCode).toBe(429);
  expect(calls).toHaveLength(1);
  expect(keyLimiter.limit).toHaveBeenCalledWith({ key: KEY_ID });
  expect(ipLimiter.limit).not.toHaveBeenCalled();
});

test('只有 write 的金鑰打 GET /api/urls → 403', async () => {
  mockVerify(okRpc(['write']));
  const { env } = setup();

  const res = await isolatedApp().request('/api/urls', keyInit(), env);

  expect(res.status).toBe(403);
  expect(await res.json()).toEqual(FORBIDDEN_BODY);
});

// ============================================================
// 有效金鑰：放行、每把金鑰各自限流
// ============================================================

test('有效金鑰 → 放行並設定呼叫者（getApiKey）', async () => {
  mockVerify(okRpc(['read']));
  const { env } = setup();

  const res = await isolatedApp().request('/api/urls/abc/stats', keyInit(), env);

  expect(res.status).toBe(200);
  const principal: ApiKeyPrincipal = {
    keyId: KEY_ID,
    name: 'svc',
    ownerId: OWNER_ID,
    scopes: ['read'],
  };
  expect(await res.json()).toEqual({ apiKey: principal });
});

test('有效金鑰 → 以 { key: keyId } 呼叫 API_KEY_RATE_LIMITER，不呼叫 RATE_LIMITER', async () => {
  mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup();

  const { res } = await workerRequest('/api/urls', keyInit(), env);
  await res.body?.cancel();

  expect(res.status).not.toBe(429);
  expect(keyLimiter.limit).toHaveBeenCalledTimes(1);
  expect(keyLimiter.limit).toHaveBeenCalledWith({ key: KEY_ID });
  expect(ipLimiter.limit).not.toHaveBeenCalled();
});

test('有效金鑰但 IP 限流已滿 → 照常放行（不吃 IP 限流）', async () => {
  mockVerify(okRpc());
  const { ipLimiter, env } = setup({ ip: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);
  await res.body?.cancel();

  expect(res.status).not.toBe(429);
  expect(ipLimiter.limit).not.toHaveBeenCalled();
});

test('API_KEY_RATE_LIMITER 回 success:false → 429（JSON），路由不會執行', async () => {
  const { calls } = mockVerify(okRpc());
  const { env } = setup({ key: false });

  const { res } = await workerRequest('/api/urls', keyInit(), env);

  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({
    statusCode: 429,
    error: 'Too Many Requests',
    message: '請求過於頻繁，請在 60 秒後重試',
  });
  expect(calls).toHaveLength(1);
});

test('API_KEY_RATE_LIMITER 異常 → 放行（fail-open，同一般限流）', async () => {
  mockVerify(okRpc());
  const env = createTestEnv({
    API_KEY_RATE_LIMITER: {
      limit: async () => {
        throw new Error('limiter down');
      },
    } as unknown as RateLimit,
  });

  const res = await isolatedApp().request('/api/urls', keyInit(), env);

  expect(res.status).toBe(200);
  expect(((await res.json()) as { apiKey: ApiKeyPrincipal }).apiKey.keyId).toBe(KEY_ID);
});

test('RATE_LIMIT_ENABLED=false → 金鑰請求也不限流', async () => {
  mockVerify({ status: 'not_found' });
  const { ipLimiter, keyLimiter, verifyLimiter, env } = setup({
    ip: false,
    key: false,
    verify: false,
    overrides: { RATE_LIMIT_ENABLED: 'false' },
  });

  const invalid = await isolatedApp().request('/api/urls', keyInit(), env);
  expect(invalid.status).toBe(401);

  mockVerify(okRpc());
  const valid = await isolatedApp().request('/api/urls', keyInit(), env);
  expect(valid.status).toBe(200);

  expect(ipLimiter.limit).not.toHaveBeenCalled();
  expect(keyLimiter.limit).not.toHaveBeenCalled();
  expect(verifyLimiter.limit).not.toHaveBeenCalled();
});

// ============================================================
// Authorization 解析
// ============================================================

test('Authorization 只有金鑰沒有 scheme → 401（不是 500），不呼叫 verify_api_key', async () => {
  const { calls } = mockVerify(okRpc());
  const { env } = setup();

  const { res } = await workerRequest('/api/urls', keyInit('GET', KEY), env);

  expect(res.status).toBe(401);
  await res.body?.cancel();
  expect(rpcCalls(calls)).toHaveLength(0);
});

test('小寫 bearer、金鑰前後夾帶空白 → 照常走金鑰驗證（以去除空白後的金鑰雜湊查詢）', async () => {
  const { calls } = mockVerify(okRpc());
  const { env } = setup();

  const res = await isolatedApp().request('/api/urls', keyInit('GET', `bearer   ${KEY}   `), env);

  expect(res.status).toBe(200);
  expect(((await res.json()) as { apiKey: ApiKeyPrincipal }).apiKey.keyId).toBe(KEY_ID);
  expect(rpcCalls(calls)).toHaveLength(1);
  expect(JSON.parse(calls[0].body!)).toEqual({ p_key_hash: await hashApiKey(KEY) });
});

test('一般 JWT 請求 → 不呼叫 verify_api_key，RATE_LIMITER 照舊以 IP 計數', async () => {
  const { calls } = mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup();

  const { res } = await workerRequest(
    '/api/urls',
    keyInit('GET', 'Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.sig'),
    env,
  );
  await res.body?.cancel();

  expect(rpcCalls(calls)).toHaveLength(0);
  expect(ipLimiter.limit).toHaveBeenCalledTimes(1);
  expect(ipLimiter.limit).toHaveBeenCalledWith({ key: IP });
  expect(keyLimiter.limit).not.toHaveBeenCalled();
});

/**
 * 含金鑰、但不是 `Bearer tcurl_sk_…` 的 Authorization（對方服務常見的設定錯誤）。
 * 若交給 JWT 流程，路由會把整段字串（含完整金鑰）當 JWT 送到 Supabase（安全審查 F2）。
 */
const MALFORMED_KEY_HEADERS: [string, string][] = [
  ['重複 Bearer', `Bearer Bearer ${KEY}`],
  ['雙引號', `Bearer "${KEY}"`],
  ['單引號', `Bearer '${KEY}'`],
  ['其他 scheme', `Token ${KEY}`],
  ['沒有 scheme', KEY],
];

/** 會以 Authorization 向 Supabase 查使用者或資料的端點（金鑰白名單內外都有） */
const AUTHED_PATHS = ['/api/urls', '/api/urls/stats/summary', '/api/auth/me', '/api/admin/stats'];

describe.each(MALFORMED_KEY_HEADERS)('Authorization 含金鑰但格式錯誤（%s）', (_label, header) => {
  test('→ 401 API 金鑰無效或已失效；沒有任何請求送到 Supabase；計入前置限流與 IP 限流', async () => {
    const { calls } = mockSupabaseFetch(() => jsonResponse({}));
    const { ipLimiter, keyLimiter, verifyLimiter, env } = setup();

    for (const path of AUTHED_PATHS) {
      const { res } = await workerRequest(path, keyInit('GET', header), env);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toEqual(INVALID_KEY_BODY);
    }

    expect(calls).toHaveLength(0);
    expect(verifyLimiter.limit).toHaveBeenCalledTimes(AUTHED_PATHS.length);
    expect(verifyLimiter.limit).toHaveBeenCalledWith({ key: IP });
    expect(ipLimiter.limit).toHaveBeenCalledTimes(AUTHED_PATHS.length);
    expect(ipLimiter.limit).toHaveBeenCalledWith({ key: IP });
    expect(keyLimiter.limit).not.toHaveBeenCalled();
  });

  test('→ 不呼叫 next()（路由不會執行）', async () => {
    mockSupabaseFetch(() => jsonResponse({}));
    const { env } = setup();

    const res = await isolatedApp().request('/api/urls', keyInit('GET', header), env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID_KEY_BODY);
  });

  test('→ 記錄 reason malformed_header 與標頭內金鑰的雜湊開頭（可對照是哪把金鑰設定錯誤）', async () => {
    mockSupabaseFetch(() => jsonResponse({}));
    const { env } = setup();

    const { res } = await workerRequest('/api/urls', keyInit('GET', header), env);
    await res.body?.cancel();

    expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
      reason: 'malformed_header',
      hashPrefix: (await hashApiKey(KEY)).slice(0, 8),
    });
  });

  test('→ 前置限流已滿時 429，同樣不送任何請求到 Supabase', async () => {
    const { calls } = mockSupabaseFetch(() => jsonResponse({}));
    const { ipLimiter, env } = setup({ verify: false });

    const { res } = await workerRequest('/api/urls', keyInit('GET', header), env);

    expect(res.status).toBe(429);
    await res.body?.cancel();
    expect(calls).toHaveLength(0);
    expect(ipLimiter.limit).not.toHaveBeenCalled();
    expect(consoleSpies.warn).toHaveBeenCalledWith('[ApiKey] verify failed', {
      reason: 'verify_rate_limited',
      hashPrefix: (await hashApiKey(KEY)).slice(0, 8),
    });
  });
});

/**
 * 金鑰前綴被改過大小寫，或底線被 URL 編碼（安全審查 m1）：仍視為金鑰嘗試。
 * 前綴是固定字串，後面 43 字元的亂數一旦被當 JWT 送到 Supabase，就等於金鑰外洩。
 */
const KEY_SECRET = KEY.slice(API_KEY_PREFIX.length);
const DISGUISED_KEY_HEADERS: [string, string][] = [
  ['前綴全大寫', `Bearer TCURL_SK_${KEY_SECRET}`],
  ['底線 URL 編碼', `Bearer tcurl%5Fsk_${KEY_SECRET}`],
  ['前綴大小寫混用', `Bearer Tcurl_Sk_${KEY_SECRET}`],
  ['第二個底線 URL 編碼', `Bearer tcurl_sk%5F${KEY_SECRET}`],
  ['兩個底線都 URL 編碼', `Bearer tcurl%5Fsk%5f${KEY_SECRET}`],
];

describe.each(DISGUISED_KEY_HEADERS)('Authorization 的金鑰前綴改了大小寫或編碼（%s）', (_label, header) => {
  test('→ 401 API 金鑰無效或已失效；沒有任何請求送到 Supabase；計入前置限流與 IP 限流', async () => {
    const { calls } = mockSupabaseFetch(() => jsonResponse({}));
    const { ipLimiter, keyLimiter, verifyLimiter, env } = setup();

    for (const path of AUTHED_PATHS) {
      const { res } = await workerRequest(path, keyInit('GET', header), env);
      expect(res.status, path).toBe(401);
      expect(await res.json(), path).toEqual(INVALID_KEY_BODY);
    }

    expect(calls).toHaveLength(0);
    expect(verifyLimiter.limit).toHaveBeenCalledTimes(AUTHED_PATHS.length);
    expect(verifyLimiter.limit).toHaveBeenCalledWith({ key: IP });
    expect(ipLimiter.limit).toHaveBeenCalledTimes(AUTHED_PATHS.length);
    expect(keyLimiter.limit).not.toHaveBeenCalled();
  });

  test('→ 不呼叫 next()（路由不會執行）', async () => {
    mockSupabaseFetch(() => jsonResponse({}));
    const { env } = setup();

    const res = await isolatedApp().request('/api/urls', keyInit('GET', header), env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(INVALID_KEY_BODY);
  });

  test('→ extractToken 回 null（第二道防線）', () => {
    expect(extractToken(header)).toBeNull();
  });
});

test('extractToken：token 含 tcurl_sk_ 時回 null（第二道防線：金鑰不會被當成 JWT）', () => {
  for (const header of [
    `Bearer ${KEY}`,
    `Bearer Bearer ${KEY}`,
    `Bearer "${KEY}"`,
    `Bearer x${API_KEY_PREFIX}`,
    `Bearer tcurl%5fsk_${KEY_SECRET}`,
  ]) {
    expect(extractToken(header), header).toBeNull();
  }
  expect(extractToken('Bearer eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.sig')).toBe(
    'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.sig',
  );
});

test('第二道防線：沒有經過 apiKeyAuth 時，路由也不會把含金鑰的 Authorization 送到 Supabase', async () => {
  const { calls } = mockSupabaseFetch(() => jsonResponse({}));
  // 只掛路由、不掛中介層：模擬日後漏掉金鑰分支，或中介層被繞過
  const routesOnly = new Hono<AppEnv>();
  for (const routes of [urlStatsRoutes, urlCrudRoutes, urlChannelRoutes, authRoutes, adminRoutes]) {
    routesOnly.route('/', routes);
  }
  const requests: [string, string][] = [
    ['GET', '/api/urls'],
    ['GET', '/api/urls/stats/summary'],
    ['GET', '/api/stats/daily'],
    ['POST', '/api/urls'],
    ['GET', `/api/urls/${KEY_ID}`],
    ['GET', `/api/urls/${KEY_ID}/channels`],
    ['GET', '/api/auth/me'],
    ['GET', '/api/admin/stats'],
    ['GET', '/api/admin/api-keys'],
  ];

  for (const [header] of [[`Bearer Bearer ${KEY}`], [`Bearer ${KEY}`]]) {
    for (const [method, path] of requests) {
      const res = await routesOnly.request(
        path,
        {
          method,
          headers: { Authorization: header, 'Content-Type': 'application/json' },
          body: method === 'POST' ? JSON.stringify({ original_url: 'https://example.com' }) : undefined,
        },
        createTestEnv(),
      );
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.text(), `${method} ${path}`).not.toContain(KEY);
    }
  }
  expect(calls).toHaveLength(0);
});

test('/api/* 以外的路徑帶金鑰 → 不走金鑰驗證，照舊以 IP 限流', async () => {
  const { calls } = mockVerify(okRpc());
  const { ipLimiter, keyLimiter, env } = setup();

  const { res } = await workerRequest('/links', keyInit(), env);
  expect(res.status).toBe(200);
  await res.body?.cancel();

  expect(rpcCalls(calls)).toHaveLength(0);
  expect(ipLimiter.limit).toHaveBeenCalledWith({ key: IP });
  expect(keyLimiter.limit).not.toHaveBeenCalled();
});

// ============================================================
// 稽核紀錄與金鑰外洩
// ============================================================

test('稽核紀錄：有效金鑰請求的頂層 apiKeyId 為 keyId；JWT 請求沒有 apiKeyId', async () => {
  mockVerify(okRpc());
  const { env } = setup();

  const keyRes = await workerRequest('/api/urls', keyInit(), env);
  await keyRes.res.body?.cancel();
  const [keyEntry] = auditEntries();
  expect(keyEntry.path).toBe('/api/urls');
  expect(keyEntry.apiKeyId).toBe(KEY_ID);

  const jwtRes = await workerRequest('/api/urls', keyInit('GET', 'Bearer eyJ.x.y'), env);
  await jwtRes.res.body?.cancel();
  const entries = auditEntries();
  expect(entries).toHaveLength(2);
  expect(entries[1]).not.toHaveProperty('apiKeyId');
});

test('稽核紀錄：有效金鑰被拒（端點不允許、權限不足）也記錄是哪把金鑰', async () => {
  mockVerify(okRpc(['read']));
  const { env } = setup();

  const admin = await workerRequest('/api/admin/stats', keyInit(), env);
  expect(admin.res.status).toBe(401);
  const write = await workerRequest('/api/urls/abc', keyInit('DELETE'), env);
  expect(write.res.status).toBe(403);

  const entries = auditEntries();
  expect(entries.map((e) => [e.path, e.apiKeyId])).toEqual([
    ['/api/admin/stats', KEY_ID],
    ['/api/urls/abc', KEY_ID],
  ]);
});

test('回應與 console 記錄都不含完整金鑰', async () => {
  const bodies: string[] = [];
  const run = async (rpcBody: Record<string, unknown>, path: string, init: RequestInit, env = setup().env) => {
    mockVerify(rpcBody);
    const { res } = await workerRequest(path, init, env);
    bodies.push(JSON.stringify([...res.headers]), await res.text());
  };

  await run({ status: 'not_found' }, '/api/urls', keyInit());
  await run({ status: 'owner_banned' }, '/api/urls', keyInit(), setup({ ip: false }).env);
  await run({ code: 'XX000' }, '/api/urls', keyInit());
  await run(okRpc(), '/api/admin/stats', keyInit());
  await run(okRpc(['read']), '/api/urls/abc', keyInit('PUT'));
  await run(okRpc(), '/api/urls', keyInit(), setup({ key: false }).env);
  await run(okRpc(), '/api/urls', keyInit(), setup({ verify: false }).env);
  await run(okRpc(), '/api/urls', keyInit('GET', `Bearer ${KEY}x`));
  await run(okRpc(), '/api/urls', keyInit());
  await run(okRpc(), '/api/urls', keyInit('GET', KEY));

  expect(bodies.join('\n')).not.toContain(KEY);
  for (const spy of Object.values(consoleSpies)) {
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  }
});

// ============================================================
// 路由共用：金鑰專用 service client、查詢範圍
// ============================================================

test('getSupabaseForApiKey：service role client，帶 x-tcurl-api-key-id 標頭', async () => {
  const { calls } = mockSupabaseFetch(() => jsonResponse([]));

  await getSupabaseForApiKey(createTestEnv(), KEY_ID).from('urls').select('id');

  expect(calls).toHaveLength(1);
  expect(calls[0].headers.get('apikey')).toBe('test-service-role-key');
  expect(calls[0].headers.get('x-tcurl-api-key-id')).toBe(KEY_ID);
});

test('getSupabase（一般 service client）不帶 x-tcurl-api-key-id 標頭', async () => {
  const { calls } = mockSupabaseFetch(() => jsonResponse([]));

  await getSupabase(createTestEnv()).from('urls').select('id');

  expect(calls[0].headers.get('x-tcurl-api-key-id')).toBeNull();
});

test('scopeToApiKey：同時限定 created_by = 負責同仁、api_key_id = 金鑰，回傳同一個 query builder', async () => {
  const { calls } = mockSupabaseFetch(() => jsonResponse([]));
  const key: ApiKeyPrincipal = { keyId: KEY_ID, name: 'svc', ownerId: OWNER_ID, scopes: ['read'] };
  const supabase = getSupabase(createTestEnv());

  const select = supabase.from('urls').select('*').eq('id', 'u1');
  const scopedSelect = scopeToApiKey(select, key);
  expect(scopedSelect).toBe(select);
  await scopedSelect.single();

  await scopeToApiKey(supabase.from('urls').delete().eq('id', 'u1'), key);

  expect(calls).toHaveLength(2);
  for (const call of calls) {
    expect(call.url.searchParams.get('id')).toBe('eq.u1');
    expect(call.url.searchParams.get('created_by')).toBe(`eq.${OWNER_ID}`);
    expect(call.url.searchParams.get('api_key_id')).toBe(`eq.${KEY_ID}`);
  }
  expect(calls[1].method).toBe('DELETE');
});
