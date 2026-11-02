/**
 * 限流測試（Workers Rate Limiting binding，鍵為 CF-Connecting-IP）
 *
 * - /api/*、HTML 頁面：RATE_LIMITER
 * - /s/*、/ad/*：只走 REDIRECT_RATE_LIMITER（不吃一般限流的額度）
 */

import { afterEach, expect, test, vi } from 'vitest';
import {
  createRateLimiter,
  createTestEnv,
  mockSupabaseFetch,
  pgrstNotFound,
  workerRequest,
} from './helpers/test-env.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('rate limit - 以 CF-Connecting-IP 為鍵呼叫 RATE_LIMITER', async () => {
  const limiter = createRateLimiter(true);
  const env = createTestEnv({ RATE_LIMITER: limiter as unknown as RateLimit });
  const { res } = await workerRequest(
    '/api/version',
    { headers: { 'CF-Connecting-IP': '203.0.113.5', 'X-Forwarded-For': '198.51.100.1' } },
    env,
  );
  expect(res.status).toBe(200);
  expect(limiter.limit).toHaveBeenCalledWith({ key: '203.0.113.5' });
});

test('rate limit - API 超過上限回傳 429 JSON', async () => {
  const env = createTestEnv({ RATE_LIMITER: createRateLimiter(false) as unknown as RateLimit });
  const { res } = await workerRequest('/api/version', {}, env);
  expect(res.status).toBe(429);
  const data = (await res.json()) as { statusCode: number; error: string; message: string };
  expect(data.statusCode).toBe(429);
  expect(data.error).toBe('Too Many Requests');
  expect(data.message).toContain('60');
});

test('rate limit - 頁面超過上限回傳 429 HTML', async () => {
  const env = createTestEnv({ RATE_LIMITER: createRateLimiter(false) as unknown as RateLimit });
  const { res } = await workerRequest('/links', {}, env);
  expect(res.status).toBe(429);
  expect(res.headers.get('content-type') || '').toContain('text/html');
  await res.body?.cancel();
});

test('rate limit - RATE_LIMIT_ENABLED=false 時不限流', async () => {
  const limiter = createRateLimiter(false);
  const env = createTestEnv({
    RATE_LIMITER: limiter as unknown as RateLimit,
    RATE_LIMIT_ENABLED: 'false',
  });
  const { res } = await workerRequest('/api/version', {}, env);
  expect(res.status).toBe(200);
  expect(limiter.limit).not.toHaveBeenCalled();
});

test('rate limit - 限流服務異常時放行', async () => {
  const env = createTestEnv({
    RATE_LIMITER: {
      limit: async () => {
        throw new Error('boom');
      },
    } as unknown as RateLimit,
  });
  const { res } = await workerRequest('/api/version', {}, env);
  expect(res.status).toBe(200);
});

// ============================================================
// 轉址路徑（/s/*、/ad/*）改用 REDIRECT_RATE_LIMITER
// ============================================================

for (const path of ['/s/abc123', '/ad/abc123']) {
  test(`rate limit - ${path} 不經過一般 RATE_LIMITER，改以 CF-Connecting-IP 呼叫 REDIRECT_RATE_LIMITER`, async () => {
    mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
    const general = createRateLimiter(false);
    const redirect = createRateLimiter(true);
    const env = createTestEnv({
      RATE_LIMITER: general as unknown as RateLimit,
      REDIRECT_RATE_LIMITER: redirect as unknown as RateLimit,
    });
    const { res } = await workerRequest(
      path,
      { redirect: 'manual', headers: { 'CF-Connecting-IP': '203.0.113.9', 'X-Forwarded-For': '198.51.100.1' } },
      env,
    );
    // 一般限流已滿也不影響轉址：照常查 DB（短碼不存在 → 404 頁）
    expect(res.status).toBe(404);
    await res.body?.cancel();
    expect(general.limit).not.toHaveBeenCalled();
    expect(redirect.limit).toHaveBeenCalledWith({ key: '203.0.113.9' });
  });

  test(`rate limit - ${path} 超過 REDIRECT_RATE_LIMITER 上限回傳 429 HTML，不查 DB`, async () => {
    const { calls } = mockSupabaseFetch();
    const env = createTestEnv({
      RATE_LIMITER: createRateLimiter(true) as unknown as RateLimit,
      REDIRECT_RATE_LIMITER: createRateLimiter(false) as unknown as RateLimit,
    });
    const { res } = await workerRequest(path, { redirect: 'manual' }, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type') || '').toContain('text/html');
    expect(await res.text()).toContain('60');
    expect(calls).toHaveLength(0);
  });
}

test('rate limit - 一般 /api/* 走 RATE_LIMITER，/api/ad/* 改走 REDIRECT_RATE_LIMITER', async () => {
  mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
  const general = createRateLimiter(true);
  const redirect = createRateLimiter(true);
  const env = createTestEnv({
    RATE_LIMITER: general as unknown as RateLimit,
    REDIRECT_RATE_LIMITER: redirect as unknown as RateLimit,
  });
  const version = await workerRequest('/api/version', {}, env);
  expect(version.res.status).toBe(200);
  expect(general.limit).toHaveBeenCalledTimes(1);
  expect(redirect.limit).not.toHaveBeenCalled();

  // 廣告頁計數 API 與轉址同屬活動現場共用 IP 的流量
  const adView = await workerRequest('/api/ad/abc123/view', { method: 'POST' }, env);
  expect(adView.res.status).toBe(404);
  await adView.res.body?.cancel();
  expect(general.limit).toHaveBeenCalledTimes(1);
  expect(redirect.limit).toHaveBeenCalledTimes(1);
});

test('rate limit - /api/ad/* 超過轉址上限時回 JSON 429', async () => {
  const general = createRateLimiter(true);
  const redirect = createRateLimiter(false);
  const env = createTestEnv({
    RATE_LIMITER: general as unknown as RateLimit,
    REDIRECT_RATE_LIMITER: redirect as unknown as RateLimit,
  });
  const { res } = await workerRequest('/api/ad/abc123/click', { method: 'POST' }, env);
  expect(res.status).toBe(429);
  expect(res.headers.get('content-type') || '').toContain('application/json');
  await res.body?.cancel();
  expect(general.limit).not.toHaveBeenCalled();
});

test('rate limit - 頁面路由仍走一般 RATE_LIMITER', async () => {
  const general = createRateLimiter(true);
  const redirect = createRateLimiter(true);
  const env = createTestEnv({
    RATE_LIMITER: general as unknown as RateLimit,
    REDIRECT_RATE_LIMITER: redirect as unknown as RateLimit,
  });
  const { res } = await workerRequest('/links', {}, env);
  expect(res.status).toBe(200);
  await res.body?.cancel();
  expect(general.limit).toHaveBeenCalledTimes(1);
  expect(redirect.limit).not.toHaveBeenCalled();
});

test('rate limit - RATE_LIMIT_ENABLED=false 時轉址也不限流', async () => {
  mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
  const redirect = createRateLimiter(false);
  const env = createTestEnv({
    REDIRECT_RATE_LIMITER: redirect as unknown as RateLimit,
    RATE_LIMIT_ENABLED: 'false',
  });
  const { res } = await workerRequest('/s/abc123', { redirect: 'manual' }, env);
  expect(res.status).toBe(404);
  await res.body?.cancel();
  expect(redirect.limit).not.toHaveBeenCalled();
});

test('rate limit - 轉址限流服務異常時放行', async () => {
  mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
  const env = createTestEnv({
    REDIRECT_RATE_LIMITER: {
      limit: async () => {
        throw new Error('boom');
      },
    } as unknown as RateLimit,
  });
  const { res } = await workerRequest('/s/abc123', { redirect: 'manual' }, env);
  expect(res.status).toBe(404);
  await res.body?.cancel();
});
