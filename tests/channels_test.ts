/**
 * 管道追蹤測試
 *
 * 測試管道 API 認證與 redirect 管道參數處理
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockSupabaseFetch, workerRequest } from './helpers/test-env.ts';

beforeEach(() => {
  mockSupabaseFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// 管道 API 認證測試
// ============================================================

const channelEndpoints = [
  { method: 'GET', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels' },
  { method: 'POST', path: '/api/urls/00000000-0000-0000-0000-000000000000/channels' },
  {
    method: 'PUT',
    path: '/api/urls/00000000-0000-0000-0000-000000000000/channels/00000000-0000-0000-0000-000000000000',
  },
  {
    method: 'DELETE',
    path: '/api/urls/00000000-0000-0000-0000-000000000000/channels/00000000-0000-0000-0000-000000000000',
  },
];

for (const { method, path } of channelEndpoints) {
  test(`channels auth - ${method} ${path} 未登入應回傳 401`, async () => {
    const hasBody = method === 'POST' || method === 'PUT';
    const { res } = await workerRequest(path, {
      method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : {},
      body: hasBody ? JSON.stringify({ name: 'test' }) : undefined,
    });
    expect(res.status, `${method} ${path} 應回傳 401，實際 ${res.status}`).toBe(401);
    await res.body?.cancel();
  });
}

// ============================================================
// Redirect 管道參數測試
// ============================================================

test('channels redirect - 帶無效 g 參數不應 500', async () => {
  const { res } = await workerRequest('/s/nonexistent?g=invalid&qr=1', { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  expect(status, `帶無效 g 參數不應 500，實際 ${status}`).not.toBe(500);
});

test('channels redirect - g 參數為空不應 500', async () => {
  const { res } = await workerRequest('/s/nonexistent?g=&qr=1', { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  expect(status, `g 參數為空不應 500，實際 ${status}`).not.toBe(500);
});

test('channels redirect - 特殊字元 g 參數不應 500', async () => {
  const badKeys = ['<script>', '../etc', 'a'.repeat(100), '中文'];
  for (const key of badKeys) {
    const { res } = await workerRequest(`/s/nonexistent?g=${encodeURIComponent(key)}`, {
      redirect: 'manual',
    });
    const status = res.status;
    await res.body?.cancel();
    expect(status, `g="${key}" 不應造成 500，實際 ${status}`).not.toBe(500);
  }
});
