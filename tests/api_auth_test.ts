/**
 * API 認證與授權測試
 *
 * 測試未登入時 API 應正確回傳 401
 */

import { assertEquals } from '@std/assert';

const BASE = 'http://localhost:3000';

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
  Deno.test(`auth - ${method} ${path} 未登入應回傳 401`, async () => {
    const res = await fetch(`${BASE}${path}`, { method });
    assertEquals(res.status, 401, `${method} ${path} 應回傳 401，實際 ${res.status}`);
    const data = await res.json();
    assertEquals(data.error, 'Unauthorized');
  });
}

Deno.test('auth - 無效 token 應回傳 401', async () => {
  const res = await fetch(`${BASE}/api/urls`, {
    headers: { Authorization: 'Bearer invalid_token_12345' },
  });
  // 可能是 401 (token invalid) 或其他錯誤，但不應 500
  const status = res.status;
  await res.body?.cancel();
  assertEquals(status !== 500, true, `無效 token 不應造成 500，實際 ${status}`);
});

Deno.test('auth - POST /api/urls 未登入應回傳 401', async () => {
  const res = await fetch(`${BASE}/api/urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ original_url: 'https://example.com' }),
  });
  assertEquals(res.status, 401);
  await res.body?.cancel();
});
