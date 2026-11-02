/**
 * URL CRUD 在 Workers 上的替換行為
 *
 * - QR Code：不再寫 PNG 檔（只保存 qr_code_options），回應格式維持相容
 * - 刪除：不再刪 QR 檔、不再清 Nginx 快取
 * - 密碼驗證：bcryptjs 相容舊版 $2a$ 雜湊；成功時以 waitUntil 背景記錄點擊；IP + 短碼專屬限流
 * - 更新：PUT 只接受白名單欄位
 */

import bcrypt from 'bcryptjs';
import { afterEach, expect, test, vi } from 'vitest';
import {
  createRateLimiter,
  createTestEnv,
  jsonResponse,
  mockSupabaseFetch,
  pgrstNotFound,
  workerRequest,
} from './helpers/test-env.ts';

const URL_ID = '33333333-3333-3333-3333-333333333333';
const AUTH = { Authorization: 'Bearer user-jwt' };

afterEach(() => {
  vi.unstubAllGlobals();
});

test('qr-code - 帶 PNG data URL 也只保存 qr_code_options，qr_code_path 為 null', async () => {
  const qrOptions = { dotsOptions: { color: '#000000' } };
  const { calls } = mockSupabaseFetch((call) => {
    if (call.url.pathname !== '/rest/v1/urls') return undefined;
    if (call.method === 'GET') {
      return jsonResponse({ short_code: 'abc123', qr_code_path: '/qrcodes/abc123.png' });
    }
    if (call.method === 'PATCH') {
      return jsonResponse({ id: URL_ID, ...JSON.parse(call.body || '{}') });
    }
    return undefined;
  });

  const { res } = await workerRequest(`/api/urls/${URL_ID}/qr-code`, {
    method: 'PATCH',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qr_code_options: qrOptions,
      qr_code_data_url: 'data:image/png;base64,iVBORw0KGgo=',
    }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    success: true,
    qr_code_path: null,
    qr_code_options: qrOptions,
  });
  const patch = calls.find((c) => c.method === 'PATCH');
  expect(JSON.parse(patch!.body || '{}')).toEqual({
    qr_code_options: qrOptions,
    qr_code_generated: true,
  });
});

test('qr-code - 缺少 qr_code_options 回傳 400', async () => {
  mockSupabaseFetch();
  const { res } = await workerRequest(`/api/urls/${URL_ID}/qr-code`, {
    method: 'PATCH',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(400);
  await res.body?.cancel();
});

test('delete - 只刪資料庫記錄', async () => {
  const { calls } = mockSupabaseFetch((call) => {
    if (call.url.pathname !== '/rest/v1/urls') return undefined;
    if (call.method === 'GET') return jsonResponse({ short_code: 'abc123' });
    if (call.method === 'DELETE') return new Response(null, { status: 204 });
    return undefined;
  });
  const { res } = await workerRequest(`/api/urls/${URL_ID}`, { method: 'DELETE', headers: AUTH });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: 'URL deleted successfully' });
  expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE']);
});

test('delete - 找不到回傳 404', async () => {
  mockSupabaseFetch((call) => (call.url.pathname === '/rest/v1/urls' ? pgrstNotFound() : undefined));
  const { res } = await workerRequest(`/api/urls/${URL_ID}`, { method: 'DELETE', headers: AUTH });
  expect(res.status).toBe(404);
  await res.body?.cancel();
});

// ============================================================
// 密碼驗證
// ============================================================

function mockProtectedUrl(passwordHash: string) {
  const clickInserts: Array<Record<string, unknown>> = [];
  mockSupabaseFetch((call) => {
    if (call.method === 'GET' && call.url.pathname === '/rest/v1/urls') {
      return jsonResponse({
        id: URL_ID,
        short_code: 'secret1',
        original_url: 'https://example.com/private',
        is_active: true,
        expires_at: null,
        password_protected: true,
        password_hash: passwordHash,
      });
    }
    if (call.method === 'POST' && call.url.pathname === '/rest/v1/url_clicks') {
      clickInserts.push(JSON.parse(call.body || '{}'));
      return new Response(null, { status: 201 });
    }
    return undefined;
  });
  return clickInserts;
}

test('verify-password - 舊版 $2a$ 雜湊可驗證，成功後背景記錄 link_click', async () => {
  // 舊版 deno.land/x/bcrypt 產生 $2a$ 前綴；測試用 cost 4 加速
  const legacyHash = '$2a$' + bcrypt.hashSync('correct-horse', 4).slice(4);
  const clickInserts = mockProtectedUrl(legacyHash);

  const { res, waitUntil, settle } = await workerRequest('/api/urls/secret1/verify-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'ua' },
    body: JSON.stringify({ password: 'correct-horse' }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    original_url: 'https://example.com/private',
    short_code: 'secret1',
  });
  expect(waitUntil).toHaveBeenCalledTimes(1);
  await settle();
  expect(clickInserts).toEqual([{ url_id: URL_ID, user_agent: 'ua', event_type: 'link_click' }]);
});

test('verify-password - 密碼頁帶 qr: true 時記為 qr_scan（只接受布林 true）', async () => {
  const hash = '$2a$' + bcrypt.hashSync('correct-horse', 4).slice(4);
  for (const [qr, expected] of [[true, 'qr_scan'], ['true', 'link_click'], [undefined, 'link_click']] as const) {
    const clickInserts = mockProtectedUrl(hash);
    const { res, settle } = await workerRequest('/api/urls/secret1/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'ua' },
      body: JSON.stringify({ password: 'correct-horse', qr }),
    });
    expect(res.status).toBe(200);
    await res.body?.cancel();
    await settle();
    expect(clickInserts).toEqual([{ url_id: URL_ID, user_agent: 'ua', event_type: expected }]);
  }
});

test('verify-password - 密碼錯誤回傳 401 且不記錄點擊', async () => {
  const clickInserts = mockProtectedUrl(bcrypt.hashSync('correct-horse', 4));
  const { res, waitUntil } = await workerRequest('/api/urls/secret1/verify-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  expect(res.status).toBe(401);
  await res.body?.cancel();
  expect(waitUntil).not.toHaveBeenCalled();
  expect(clickInserts.length).toBe(0);
});

test('verify-password - 專屬限流以 IP + 短碼為鍵，超過時回 429 且不查資料庫', async () => {
  const { calls } = mockSupabaseFetch();
  const limiter = createRateLimiter(false);
  const env = createTestEnv({ PASSWORD_RATE_LIMITER: limiter as unknown as RateLimit });

  const { res } = await workerRequest(
    '/api/urls/secret1/verify-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ password: 'guess' }),
    },
    env,
  );

  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('60');
  expect(await res.json()).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.7:secret1' });
  expect(calls).toHaveLength(0);
});

test('verify-password - 未超過專屬限流時正常驗證', async () => {
  const clickInserts = mockProtectedUrl(bcrypt.hashSync('correct-horse', 4));
  const limiter = createRateLimiter(true);
  const env = createTestEnv({ PASSWORD_RATE_LIMITER: limiter as unknown as RateLimit });
  const { res } = await workerRequest(
    '/api/urls/secret1/verify-password',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.2' },
      body: JSON.stringify({ password: 'wrong' }),
    },
    env,
  );
  expect(res.status).toBe(401);
  await res.body?.cancel();
  expect(limiter.limit).toHaveBeenCalledWith({ key: '198.51.100.2:secret1' });
  expect(clickInserts.length).toBe(0);
});

// ============================================================
// 更新（PUT 白名單）
// ============================================================

function mockUrlUpdate() {
  const { calls } = mockSupabaseFetch((call) => {
    if (call.method === 'PATCH' && call.url.pathname === '/rest/v1/urls') {
      return jsonResponse({ id: URL_ID, ...JSON.parse(call.body || '{}') });
    }
    return undefined;
  });
  return () => calls.filter((c) => c.method === 'PATCH');
}

function putUrl(body: unknown) {
  return workerRequest(`/api/urls/${URL_ID}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('update - 只把白名單欄位送進資料庫', async () => {
  const patches = mockUrlUpdate();
  const { res } = await putUrl({
    original_url: 'https://example.com/new',
    is_active: false,
    expires_at: null,
    // 以下都不可由請求更新
    qr_code_path: '/../.env',
    created_by: '55555555-5555-5555-5555-555555555555',
    user_id: '55555555-5555-5555-5555-555555555555',
    updated_by: '55555555-5555-5555-5555-555555555555',
    password_hash: 'not-a-bcrypt-hash',
    short_code: 'hijack',
    id: '66666666-6666-6666-6666-666666666666',
    created_at: '2000-01-01T00:00:00Z',
    qr_code_options: { evil: true },
  });

  expect(res.status).toBe(200);
  await res.body?.cancel();
  expect(patches()).toHaveLength(1);
  expect(patches()[0].url.searchParams.get('id')).toBe(`eq.${URL_ID}`);
  expect(JSON.parse(patches()[0].body || '{}')).toEqual({
    original_url: 'https://example.com/new',
    is_active: false,
    expires_at: null,
  });
});

test('update - 密碼只以 bcrypt 雜湊寫入，忽略請求帶的 password_hash', async () => {
  const patches = mockUrlUpdate();
  const { res } = await putUrl({
    password_protected: true,
    password: 'new-secret',
    password_hash: 'attacker-controlled',
  });

  expect(res.status).toBe(200);
  await res.body?.cancel();
  const sent = JSON.parse(patches()[0].body || '{}');
  expect(Object.keys(sent).sort()).toEqual(['password_hash', 'password_protected']);
  expect(sent.password_protected).toBe(true);
  expect(sent.password_hash).not.toBe('attacker-controlled');
  expect(bcrypt.compareSync('new-secret', sent.password_hash)).toBe(true);
});

test('update - 停用密碼保護時清除 password_hash', async () => {
  const patches = mockUrlUpdate();
  const { res } = await putUrl({ password_protected: false, password: null });
  expect(res.status).toBe(200);
  await res.body?.cancel();
  expect(JSON.parse(patches()[0].body || '{}')).toEqual({
    password_protected: false,
    password_hash: null,
  });
});

test('update - 只有不允許的欄位時回 400 且不寫入資料庫', async () => {
  const patches = mockUrlUpdate();
  const { res } = await putUrl({ qr_code_path: '/../.env', created_by: 'someone-else' });
  expect(res.status).toBe(400);
  await res.body?.cancel();
  expect(patches()).toHaveLength(0);
});

test.each([
  ['original_url 非字串', { original_url: 123 }],
  ['original_url 為空字串', { original_url: '' }],
  ['original_url 為 javascript:', { original_url: 'javascript:alert(1)' }],
  ['is_active 非布林', { is_active: 'yes' }],
  ['expires_at 非字串', { expires_at: 12345 }],
  ['password_protected 非布林', { password_protected: 'true' }],
  ['password 非字串', { password: { $ne: '' } }],
])('update - %s 回 400 且不寫入資料庫', async (_label, body) => {
  const patches = mockUrlUpdate();
  const { res } = await putUrl(body);
  expect(res.status).toBe(400);
  await res.body?.cancel();
  expect(patches()).toHaveLength(0);
});
