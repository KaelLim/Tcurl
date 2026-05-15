/**
 * 管道追蹤測試
 *
 * 測試管道 API 認證與 redirect 管道參數處理
 */

import { assertEquals } from '@std/assert';

const BASE = 'http://localhost:3000';

// ============================================================
// 管道 API 認證測試
// ============================================================

const channelEndpoints = [
  { method: 'GET', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels' },
  { method: 'POST', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels' },
  { method: 'PUT', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels/00000000-0000-0000-0000-000000000000' },
  { method: 'DELETE', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels/00000000-0000-0000-0000-000000000000' },
];

for (const { method, path } of channelEndpoints) {
  Deno.test(`channels auth - ${method} ${path} 未登入應回傳 401`, async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: method === 'POST' || method === 'PUT' ? { 'Content-Type': 'application/json' } : {},
      body: method === 'POST' || method === 'PUT' ? JSON.stringify({ name: 'test' }) : undefined,
    });
    assertEquals(res.status, 401, `${method} ${path} 應回傳 401，實際 ${res.status}`);
    await res.body?.cancel();
  });
}

// ============================================================
// Redirect 管道參數測試
// ============================================================

Deno.test('channels redirect - 帶無效 g 參數不應 500', async () => {
  const res = await fetch(`${BASE}/s/nonexistent?g=invalid&qr=1`, { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  assertEquals(status !== 500, true, `帶無效 g 參數不應 500，實際 ${status}`);
});

Deno.test('channels redirect - g 參數為空不應 500', async () => {
  const res = await fetch(`${BASE}/s/nonexistent?g=&qr=1`, { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  assertEquals(status !== 500, true, `g 參數為空不應 500，實際 ${status}`);
});

Deno.test('channels redirect - 特殊字元 g 參數不應 500', async () => {
  const badKeys = ['<script>', '../etc', 'a'.repeat(100), '中文'];
  for (const key of badKeys) {
    const res = await fetch(`${BASE}/s/nonexistent?g=${encodeURIComponent(key)}`, { redirect: 'manual' });
    const status = res.status;
    await res.body?.cancel();
    assertEquals(status !== 500, true, `g="${key}" 不應造成 500，實際 ${status}`);
  }
});
