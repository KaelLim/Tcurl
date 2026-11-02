/**
 * 管理員 API
 *
 * - 管理員判斷：email 在 ADMIN_EMAILS 內，且 email_confirmed_at 必須存在
 * - GET /api/admin/urls：建立者以一次 listUsers 取回（不再每位建立者一個 subrequest），
 *   limit 有上限，整個請求的 subrequest 數不超過 45（Workers Free 方案上限 50）
 */

import { afterEach, expect, test, vi } from 'vitest';
import { type SupabaseCall, jsonResponse, mockSupabaseFetch, workerRequest } from './helpers/test-env.ts';

const AUTH = { Authorization: 'Bearer admin-jwt' };

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** 產生 n 筆 URL，建立者輪流為 creators[i % creators.length] */
function makeUrls(n: number, creators: string[]) {
  return Array.from({ length: n }, (_, i) => ({
    id: uuid(1000 + i),
    short_code: `code${i}`,
    original_url: `https://example.com/${i}`,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    created_by: creators[i % creators.length],
  }));
}

function creatorUser(id: string, meta: Record<string, unknown>) {
  return { ...authUser({ id, email: `${id.slice(-4)}@example.com`, user_metadata: meta }) };
}

interface MockOptions {
  user?: Record<string, unknown>;
  urls?: ReturnType<typeof makeUrls>;
  /** listUsers 回傳的使用者 */
  listed?: Array<ReturnType<typeof creatorUser>>;
  /** 只能用 getUserById 取得的使用者 */
  byId?: Array<ReturnType<typeof creatorUser>>;
}

function mockAdminDb(opts: MockOptions = {}) {
  const urls = opts.urls ?? [];
  const listed = opts.listed ?? [];
  const byId = new Map((opts.byId ?? []).map((u) => [u.id, u]));
  const { calls } = mockSupabaseFetch((call: SupabaseCall) => {
    const path = call.url.pathname;
    if (path === '/auth/v1/user') return jsonResponse(opts.user ?? authUser());
    if (path === '/rest/v1/urls' && call.method === 'GET') {
      return new Response(JSON.stringify(urls), {
        headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${urls.length - 1}/${urls.length}` },
      });
    }
    if (path === '/rest/v1/url_clicks' && call.method === 'HEAD') {
      return new Response(null, { headers: { 'Content-Range': '*/7' } });
    }
    if (path === '/auth/v1/admin/users') {
      return jsonResponse({ users: listed, aud: 'authenticated' });
    }
    const m = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
    if (m) {
      const u = byId.get(m[1]);
      return u ? jsonResponse(u) : jsonResponse({ code: 404, msg: 'User not found' }, 404);
    }
    return undefined;
  });
  return { calls };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 管理員判斷（[L4] email_confirmed_at）
// ============================================================

test('admin check - email 已驗證且在 ADMIN_EMAILS 內 → is_admin: true', async () => {
  mockAdminDb();
  const { res } = await workerRequest('/api/admin/check', { headers: AUTH });
  expect(await res.json()).toEqual({ is_admin: true });
});

test('admin check - email 未驗證（email_confirmed_at 為 null）→ 不是管理員', async () => {
  mockAdminDb({ user: authUser({ email_confirmed_at: null }) });
  const { res } = await workerRequest('/api/admin/check', { headers: AUTH });
  expect(await res.json()).toEqual({ is_admin: false });
});

test('admin API - email 未驗證時一律 401', async () => {
  mockAdminDb({ user: authUser({ email_confirmed_at: undefined }) });
  for (const path of ['/api/admin/stats', '/api/admin/urls', '/api/admin/users', '/api/admin/feedbacks']) {
    const { res } = await workerRequest(path, { headers: AUTH });
    expect(res.status, path).toBe(401);
    await res.body?.cancel();
  }
});

test('admin check - 不在 ADMIN_EMAILS 內 → 不是管理員', async () => {
  mockAdminDb({ user: authUser({ email: 'someone@example.com' }) });
  const { res } = await workerRequest('/api/admin/check', { headers: AUTH });
  expect(await res.json()).toEqual({ is_admin: false });
});

// ============================================================
// GET /api/admin/urls（[L3] subrequest 數）
// ============================================================

test('admin urls - 建立者以一次 listUsers 取回，回應格式不變', async () => {
  const creators = [uuid(1), uuid(2), uuid(3)];
  const { calls } = mockAdminDb({
    urls: makeUrls(20, creators),
    listed: [
      creatorUser(creators[0], { full_name: 'Alice Chen', name: 'Alice' }),
      creatorUser(creators[1], { display_name: '小明' }),
      creatorUser(creators[2], {}),
    ],
  });
  const { res } = await workerRequest('/api/admin/urls', { headers: AUTH });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    data: Array<{ id: string; created_by: string; click_count: number; creator: { email: string; display_name: string } | null }>;
    total: number;
    page: number;
    limit: number;
  };
  expect(body.total).toBe(20);
  expect(body.page).toBe(1);
  expect(body.limit).toBe(20);
  expect(body.data).toHaveLength(20);
  expect(body.data[0].click_count).toBe(7);
  expect(body.data[0].creator).toEqual({ email: '0001@example.com', display_name: 'Alice Chen' });
  expect(body.data[1].creator).toEqual({ email: '0002@example.com', display_name: '小明' });
  expect(body.data[2].creator).toEqual({ email: '0003@example.com', display_name: '0003' });

  const listCalls = calls.filter((c) => c.url.pathname === '/auth/v1/admin/users');
  expect(listCalls).toHaveLength(1);
  expect(listCalls[0].url.searchParams.get('per_page')).toBe('1000');
  expect(calls.filter((c) => c.url.pathname.startsWith('/auth/v1/admin/users/'))).toHaveLength(0);
  // 1 getUser + 1 urls + 1 listUsers + 20 click counts
  expect(calls).toHaveLength(23);
});

test('admin urls - listUsers 找不到的建立者才逐筆 getUserById', async () => {
  const creators = [uuid(1), uuid(2)];
  const { calls } = mockAdminDb({
    urls: makeUrls(4, creators),
    listed: [creatorUser(creators[0], { name: 'Listed' })],
    byId: [creatorUser(creators[1], { name: 'ById' })],
  });
  const { res } = await workerRequest('/api/admin/urls', { headers: AUTH });
  const body = (await res.json()) as { data: Array<{ creator: { display_name: string } | null }> };
  expect(body.data.map((d) => d.creator?.display_name)).toEqual(['Listed', 'ById', 'Listed', 'ById']);
  const byIdCalls = calls.filter((c) => c.url.pathname.startsWith('/auth/v1/admin/users/'));
  expect(byIdCalls.map((c) => c.url.pathname)).toEqual([`/auth/v1/admin/users/${creators[1]}`]);
});

test('admin urls - limit 上限為 40，最壞情況 subrequest 也不超過 45', async () => {
  // 40 筆、40 位不同建立者，而且 listUsers 全部找不到（最壞情況）
  const creators = Array.from({ length: 40 }, (_, i) => uuid(i + 1));
  const { calls } = mockAdminDb({
    urls: makeUrls(40, creators),
    listed: [],
    byId: creators.map((id) => creatorUser(id, { name: id })),
  });
  const { res } = await workerRequest('/api/admin/urls?limit=100', { headers: AUTH });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { limit: number; data: unknown[] };
  expect(body.limit).toBe(40);

  const urlsCall = calls.find((c) => c.url.pathname === '/rest/v1/urls');
  expect(urlsCall?.url.searchParams.get('limit')).toBe('40');
  expect(calls.length).toBeLessThanOrEqual(45);
});

test('admin urls - 無效的 page / limit 參數會被修正（不產生 NaN 或負數 range）', async () => {
  const { calls } = mockAdminDb({ urls: [] });
  const { res } = await workerRequest('/api/admin/urls?page=abc&limit=-5', { headers: AUTH });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { page: number; limit: number; data: unknown[] };
  expect(body.page).toBe(1);
  expect(body.limit).toBe(1);
  const urlsCall = calls.find((c) => c.url.pathname === '/rest/v1/urls');
  expect(urlsCall?.url.searchParams.get('offset')).toBe('0');
  // 沒有 URL 就不查使用者
  expect(calls.filter((c) => c.url.pathname.startsWith('/auth/v1/admin/'))).toHaveLength(0);
});

test('admin urls - 沒帶 limit 時預設 20 筆', async () => {
  const { calls } = mockAdminDb({ urls: [] });
  const { res } = await workerRequest('/api/admin/urls', { headers: AUTH });
  expect(((await res.json()) as { limit: number }).limit).toBe(20);
  expect(calls.find((c) => c.url.pathname === '/rest/v1/urls')?.url.searchParams.get('limit')).toBe('20');
});

// ============================================================
// /api/admin/stats（原版既有問題：today_clicks 欄位、listUsers 只取 50 筆）
// ============================================================

test('admin stats - 今日點擊以 clicked_at 篩選，listUsers 一次取到上限而非預設 50 筆', async () => {
  const { calls } = mockAdminDb({ listed: [authUser()] });
  const { res } = await workerRequest('/api/admin/stats', { headers: AUTH });
  expect(res.status).toBe(200);
  await res.body?.cancel();
  const clickQueries = calls.filter((c) => c.url.pathname === '/rest/v1/url_clicks');
  const todayQuery = clickQueries.find((c) => [...c.url.searchParams.keys()].some((k) => k !== 'select'));
  expect(todayQuery?.url.searchParams.get('clicked_at')).toMatch(/^gte\./);
  expect(todayQuery?.url.searchParams.has('created_at')).toBe(false);
  const list = calls.find((c) => c.url.pathname === '/auth/v1/admin/users');
  expect(list?.url.searchParams.get('per_page')).toBe('1000');
});
