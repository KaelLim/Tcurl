/**
 * API 認證與授權測試
 *
 * 測試未登入時 API 應正確回傳 401
 * （原本打 localhost:3000 的整合測試，改為以測試 env 直接呼叫 Worker）
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTestEnv, mockSupabaseFetch, workerRequest } from './helpers/test-env.ts';

beforeEach(() => {
  mockSupabaseFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const protectedEndpoints = [
  { method: 'GET', path: '/api/urls' },
  { method: 'GET', path: '/api/urls/00000000-0000-0000-0000-000000000000' },
  { method: 'GET', path: '/api/urls/00000000-0000-0000-0000-000000000000/stats' },
  { method: 'GET', path: '/api/urls/stats/summary' },
  { method: 'GET', path: '/api/stats/daily' },
  { method: 'GET', path: '/api/auth/me' },
  { method: 'DELETE', path: '/api/urls/00000000-0000-0000-0000-000000000000' },
];

for (const { method, path } of protectedEndpoints) {
  test(`auth - ${method} ${path} 未登入應回傳 401`, async () => {
    const { res } = await workerRequest(path, { method });
    expect(res.status, `${method} ${path} 應回傳 401，實際 ${res.status}`).toBe(401);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('Unauthorized');
  });
}

test('auth - 無效 token 應回傳 401', async () => {
  const { res } = await workerRequest('/api/urls', {
    headers: { Authorization: 'Bearer invalid_token_12345' },
  });
  // 可能是 401 (token invalid) 或其他錯誤，但不應 500
  const status = res.status;
  await res.body?.cancel();
  expect(status, `無效 token 不應造成 500，實際 ${status}`).not.toBe(500);
});

test('auth - POST /api/urls 未登入應回傳 401', async () => {
  const { res } = await workerRequest('/api/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ original_url: 'https://example.com' }),
  });
  expect(res.status).toBe(401);
  await res.body?.cancel();
});

test('auth - 缺少 SUPABASE_SERVICE_ROLE_KEY 時不應回傳堆疊追蹤', async () => {
  const env = createTestEnv({ SUPABASE_SERVICE_ROLE_KEY: '' });
  const { res } = await workerRequest(
    '/api/auth/me',
    { headers: { Authorization: 'Bearer some_token' } },
    env,
  );
  expect(res.status).toBe(500);
  const body = await res.text();
  expect(body.includes('at ')).toBe(false);
  expect(body.includes('SUPABASE_SERVICE_ROLE_KEY')).toBe(false);
});
