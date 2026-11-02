/**
 * 廣告頁路由的存取控制（比照 /s/:code）
 *
 * - GET /ad/:code、POST /api/ad/:code/view、POST /api/ad/:code/click
 *   都要檢查 is_active、expires_at、password_protected
 * - 有密碼保護時不得回傳或嵌入目的網址
 * - 頁面只會把 http(s) 目的網址放進導向目標
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { jsonResponse, mockSupabaseFetch, pgrstNotFound, workerRequest } from './helpers/test-env.ts';

const TARGET = 'https://example.com/secret-target';

const BASE_ROW = {
  id: '44444444-4444-4444-4444-444444444444',
  short_code: 'ad1234',
  original_url: TARGET,
  is_active: true,
  expires_at: null as string | null,
  password_protected: false,
  password_hash: null as string | null,
};

function mockAdDb(overrides: Partial<typeof BASE_ROW> = {}) {
  const row = { ...BASE_ROW, ...overrides };
  const clickInserts: Array<Record<string, unknown>> = [];
  mockSupabaseFetch((call) => {
    if (call.method === 'GET' && call.url.pathname === '/rest/v1/urls') {
      return call.url.searchParams.get('short_code') === `eq.${row.short_code}`
        ? jsonResponse(row)
        : pgrstNotFound();
    }
    if (call.method === 'POST' && call.url.pathname === '/rest/v1/url_clicks') {
      clickInserts.push(JSON.parse(call.body || '{}'));
      return new Response(null, { status: 201 });
    }
    return undefined;
  });
  return { clickInserts };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const blockedCases = [
  {
    name: '已停用',
    row: { is_active: false },
    page: { status: 404, contains: '此短網址不存在或已失效' },
    api: 404,
  },
  {
    name: '已過期',
    row: { expires_at: '2000-01-01T00:00:00Z' },
    page: { status: 200, contains: '連結已過期' },
    api: 410,
  },
  {
    name: '有密碼保護',
    row: { password_protected: true, password_hash: '$2a$10$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz012' },
    page: { status: 200, contains: '此連結受密碼保護' },
    api: 403,
  },
];

describe.each(blockedCases)('ad - $name', ({ row, page, api }) => {
  test('GET /ad/:code 不嵌入目的網址', async () => {
    mockAdDb(row);
    const { res } = await workerRequest('/ad/ad1234');
    expect(res.status).toBe(page.status);
    const body = await res.text();
    expect(body).toContain(page.contains);
    expect(body).not.toContain(TARGET);
    expect(body).not.toContain('example.com');
  });

  test('POST /api/ad/:code/view 拒絕且不記錄', async () => {
    const { clickInserts } = mockAdDb(row);
    const { res } = await workerRequest('/api/ad/ad1234/view', { method: 'POST' });
    expect(res.status).toBe(api);
    await res.body?.cancel();
    expect(clickInserts).toEqual([]);
  });

  test('POST /api/ad/:code/click 拒絕、不記錄、不回傳目的網址', async () => {
    const { clickInserts } = mockAdDb(row);
    const { res } = await workerRequest('/api/ad/ad1234/click', { method: 'POST' });
    expect(res.status).toBe(api);
    const text = await res.text();
    expect(text).not.toContain(TARGET);
    expect(JSON.parse(text)).not.toHaveProperty('original_url');
    expect(clickInserts).toEqual([]);
  });
});

describe('ad - 一般可用的短網址', () => {
  test('GET /ad/:code 顯示廣告頁與目的網址', async () => {
    mockAdDb();
    const { res } = await workerRequest('/ad/ad1234');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('即將前往');
    expect(body).toContain(`const originalUrl = '${TARGET}'`);
  });

  test('POST /api/ad/:code/view 記錄 ad_view', async () => {
    const { clickInserts } = mockAdDb();
    const { res } = await workerRequest('/api/ad/ad1234/view', {
      method: 'POST',
      headers: { 'User-Agent': 'ua' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(clickInserts).toEqual([{ url_id: BASE_ROW.id, user_agent: 'ua', event_type: 'ad_view' }]);
  });

  test('POST /api/ad/:code/click 記錄 ad_click 並回傳目的網址', async () => {
    const { clickInserts } = mockAdDb();
    const { res } = await workerRequest('/api/ad/ad1234/click', {
      method: 'POST',
      headers: { 'User-Agent': 'ua' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, original_url: TARGET });
    expect(clickInserts).toEqual([{ url_id: BASE_ROW.id, user_agent: 'ua', event_type: 'ad_click' }]);
  });

  test('不存在的短碼：頁面 404、API 404', async () => {
    mockAdDb();
    const page = await workerRequest('/ad/nope99');
    expect(page.res.status).toBe(404);
    await page.res.body?.cancel();
    const api = await workerRequest('/api/ad/nope99/click', { method: 'POST' });
    expect(api.res.status).toBe(404);
    await api.res.body?.cancel();
  });
});

describe('ad - 非 http(s) 目的網址不會放進頁面', () => {
  test.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt://tzuchi.org/%0aalert(document.cookie)',
    'data:text/html,<script>alert(document.cookie)</script>',
    'chrome-extension://abcdefghijklmnop/page.html',
  ])('%s', async (originalUrl) => {
    mockAdDb({ original_url: originalUrl });
    const { res } = await workerRequest('/ad/ad1234');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("const originalUrl = ''");
    expect(body).not.toContain('alert(document.cookie)');
    expect(body).not.toContain('abcdefghijklmnop');
    expect(body).not.toMatch(/tzuchi\.org\/%0a/i);
    expect(body).toContain('無效的目的網址');
  });
});
