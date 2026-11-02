/**
 * 網域相關：經 Pages 入口（service binding）轉進來時，Worker 看到的是使用者看到的網域。
 * - 未設定 BASE_URL 時，建立短網址回傳的 short_url 以請求的網域為準
 * - CORS_ORIGIN 可用逗號列出多個允許來源
 */
import { afterEach, expect, test, vi } from 'vitest';
import { createTestEnv, jsonResponse, mockSupabaseFetch, workerRequest } from './helpers/test-env.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('CORS_ORIGIN 以逗號列出多個來源時，每一個都允許', async () => {
  const env = createTestEnv({ CORS_ORIGIN: 'https://tcurl.pages.dev, https://short.example.org' });
  for (const origin of ['https://tcurl.pages.dev', 'https://short.example.org', 'https://url.tzuchi.org']) {
    const { res } = await workerRequest('/api/version', { headers: { Origin: origin } }, env);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    await res.body?.cancel();
  }
  const { res } = await workerRequest('/api/version', { headers: { Origin: 'https://evil.example' } }, env);
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
  await res.body?.cancel();
});

test('未設定 BASE_URL 時，POST /api/urls 回傳的 short_url 使用請求的網域', async () => {
  mockSupabaseFetch((call) => {
    if (call.url.pathname === '/auth/v1/user') {
      return jsonResponse({ id: '11111111-1111-1111-1111-111111111111', aud: 'authenticated', role: 'authenticated',
        email: 'u@tzuchi.org.tw', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
    }
    if (call.url.pathname === '/rest/v1/urls' && call.method === 'GET') return jsonResponse([]);
    if (call.url.pathname === '/rest/v1/urls' && call.method === 'POST') {
      return jsonResponse({ id: 'u1', short_code: 'abc123', original_url: 'https://example.com' }, 201);
    }
    return undefined;
  });
  const env = createTestEnv({ BASE_URL: undefined });
  const { res } = await workerRequest('https://short.example.org/api/urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({ original_url: 'https://example.com' }),
  }, env);
  const body = await res.json() as { short_url?: string };
  expect(res.status).toBe(201);
  expect(body.short_url).toBe('https://short.example.org/s/abc123');
});
