/**
 * 轉址快取（Workers KV：REDIRECT_CACHE）
 *
 * - /s/:code 先查 KV，命中時不查 Supabase（點擊照樣背景寫入 url_clicks）
 * - 快取最多 60 秒（KV 最短 expirationTtl）；到期時間、密碼保護在命中時照樣判斷
 * - 找不到的短碼不快取；KV 內不存密碼雜湊
 * - 後端修改／刪除網址或管道時主動清除快取
 * - KV 故障時退回資料庫
 */

import { afterEach, expect, test, vi } from 'vitest';
import {
  createMemoryKv,
  createTestEnv,
  jsonResponse,
  mockSupabaseFetch,
  pgrstNotFound,
  workerRequest,
} from './helpers/test-env.ts';
import type { Bindings } from '../src/types/env.ts';

const AUTH = { Authorization: 'Bearer user-jwt' };
const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012';

/** public.urls 的完整欄位（select('*') 的實際回傳） */
const URL_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  short_code: 'abc123',
  original_url: 'https://example.com/landing?x=1',
  qr_code_generated: false,
  qr_code_path: null,
  created_at: '2026-10-01T00:00:00+00:00',
  updated_at: '2026-10-01T00:00:00+00:00',
  expires_at: null as string | null,
  is_active: true,
  password_protected: false,
  password_hash: null as string | null,
  qr_code_options: null,
  created_by: '99999999-9999-9999-9999-999999999999',
  updated_by: null,
};

/** public.url_channels 的完整欄位 */
const CHANNEL_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  url_id: URL_ROW.id,
  group_key: 'grp001',
  name: 'FB',
  utm_source: 'facebook' as string | null,
  utm_medium: 'social' as string | null,
  utm_campaign: null as string | null,
  utm_content: null as string | null,
  utm_term: null as string | null,
  created_at: '2026-10-01T00:00:00+00:00',
};

type UrlRow = typeof URL_ROW;
type ChannelRow = typeof CHANNEL_ROW;

/** 有狀態的假資料庫：PUT / DELETE 會真的改變之後查到的資料 */
function mockDb(initial: { url?: UrlRow | null; channel?: ChannelRow | null } = {}) {
  const state = {
    url: initial.url === undefined ? { ...URL_ROW } : initial.url,
    channel: initial.channel === undefined ? { ...CHANNEL_ROW } : initial.channel,
  };
  const counts = { urlLookups: 0, channelLookups: 0 };
  const clickInserts: Array<Record<string, unknown>> = [];

  mockSupabaseFetch(async (call) => {
    const { pathname, searchParams } = call.url;
    const wantsRows = (call.headers.get('prefer') || '').includes('return=representation');

    if (pathname === '/rest/v1/urls') {
      if (call.method === 'GET' && searchParams.has('short_code')) {
        // 轉址查詢：short_code + is_active=true
        counts.urlLookups++;
        const row = state.url;
        const match =
          row &&
          searchParams.get('short_code') === `eq.${row.short_code}` &&
          (!searchParams.has('is_active') || row.is_active);
        return match ? jsonResponse(row) : pgrstNotFound();
      }
      if (call.method === 'GET' && searchParams.has('id')) {
        // PUT / DELETE 前的擁有者檢查
        return state.url && searchParams.get('id') === `eq.${state.url.id}`
          ? jsonResponse(state.url)
          : pgrstNotFound();
      }
      if (call.method === 'PATCH' && state.url) {
        state.url = { ...state.url, ...JSON.parse(call.body || '{}') };
        return jsonResponse(state.url);
      }
      if (call.method === 'DELETE' && state.url) {
        const deleted = state.url;
        state.url = null;
        return wantsRows ? jsonResponse([deleted]) : new Response(null, { status: 204 });
      }
    }

    if (pathname === '/rest/v1/url_channels') {
      if (call.method === 'GET') {
        counts.channelLookups++;
        const ch = state.channel;
        const match =
          ch &&
          searchParams.get('group_key') === `eq.${ch.group_key}` &&
          searchParams.get('url_id') === `eq.${ch.url_id}`;
        return match ? jsonResponse(ch) : pgrstNotFound();
      }
      if (call.method === 'PATCH' && state.channel) {
        state.channel = { ...state.channel, ...JSON.parse(call.body || '{}') };
        return jsonResponse(state.channel);
      }
      if (call.method === 'DELETE' && state.channel) {
        const deleted = state.channel;
        state.channel = null;
        return wantsRows ? jsonResponse([deleted]) : new Response(null, { status: 204 });
      }
    }

    if (call.method === 'POST' && pathname === '/rest/v1/url_clicks') {
      clickInserts.push(JSON.parse(call.body || '{}'));
      return new Response(null, { status: 201 });
    }
    return undefined;
  });

  return { state, counts, clickInserts };
}

/** 每個測試共用同一個 KV（同一個 env），模擬連續的多次請求 */
function cacheEnv(kv: unknown = createMemoryKv()): Bindings {
  return createTestEnv({ REDIRECT_CACHE: kv as KVNamespace } as Partial<Bindings>);
}

/** 發出請求並等背景工作（點擊寫入、快取寫入）完成 */
async function send(env: Bindings, path: string, init: RequestInit = {}) {
  const { res, settle } = await workerRequest(path, { redirect: 'manual', ...init }, env);
  await settle();
  return res;
}

const T0 = new Date('2026-11-02T00:00:00Z').getTime();

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('cache - 第二次轉址命中快取不查資料庫，仍照常轉址並記錄點擊', async () => {
  const db = mockDb();
  const env = cacheEnv();

  const first = await send(env, '/s/abc123');
  const second = await send(env, '/s/abc123');

  expect(first.status).toBe(302);
  expect(second.status).toBe(302);
  expect(second.headers.get('location')).toBe('https://example.com/landing?x=1');
  expect(db.counts.urlLookups).toBe(1);
  expect(db.clickInserts).toEqual([
    { url_id: URL_ROW.id, user_agent: null, event_type: 'link_click', channel_id: null },
    { url_id: URL_ROW.id, user_agent: null, event_type: 'link_click', channel_id: null },
  ]);
});

test('cache - 60 秒內沿用快取，超過 60 秒重新查資料庫', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const db = mockDb();
  const env = cacheEnv();

  await send(env, '/s/abc123');
  vi.setSystemTime(T0 + 59_000);
  await send(env, '/s/abc123');
  expect(db.counts.urlLookups).toBe(1);

  vi.setSystemTime(T0 + 61_000);
  const res = await send(env, '/s/abc123');
  expect(res.status).toBe(302);
  expect(db.counts.urlLookups).toBe(2);
});

test('cache - 找不到的短碼不快取：建立後馬上可以轉址', async () => {
  const db = mockDb({ url: null });
  const env = cacheEnv();

  const missing = await send(env, '/s/abc123');
  expect(missing.status).toBe(404);

  db.state.url = { ...URL_ROW };
  const created = await send(env, '/s/abc123');
  expect(created.status).toBe(302);
  expect(db.counts.urlLookups).toBe(2);
});

test('cache - 命中快取時照樣檢查到期時間：到期後顯示過期頁且不記錄點擊', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const db = mockDb({ url: { ...URL_ROW, expires_at: new Date(T0 + 30_000).toISOString() } });
  const env = cacheEnv();

  expect((await send(env, '/s/abc123')).status).toBe(302);

  vi.setSystemTime(T0 + 31_000);
  const expired = await send(env, '/s/abc123');
  expect(expired.status).toBe(200);
  expect(await expired.text()).toContain('連結已過期');
  expect(db.counts.urlLookups).toBe(1);
  expect(db.clickInserts.length).toBe(1);
});

test('cache - 密碼保護：命中快取仍顯示密碼頁，KV 內不含密碼雜湊', async () => {
  const kv = createMemoryKv();
  const db = mockDb({
    url: { ...URL_ROW, password_protected: true, password_hash: PASSWORD_HASH },
  });
  const env = cacheEnv(kv);

  for (let i = 0; i < 2; i++) {
    const res = await send(env, '/s/abc123');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('密碼保護');
    expect(body).not.toContain(URL_ROW.original_url);
  }
  expect(db.counts.urlLookups).toBe(1);
  expect(db.clickInserts.length).toBe(0);

  const { keys } = await kv.list();
  expect(keys.length).toBeGreaterThan(0);
  for (const { name } of keys) {
    const raw = (await kv.get(name)) as string;
    expect(raw).not.toContain(PASSWORD_HASH);
    expect(raw).not.toContain('password_hash');
  }
});

test('cache - 管道 ?g= 也快取：第二次不查管道，仍附加 UTM 並記錄 channel_id', async () => {
  const db = mockDb();
  const env = cacheEnv();

  for (let i = 0; i < 2; i++) {
    const res = await send(env, '/s/abc123?g=grp001&qr=1');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('x')).toBe('1');
    expect(location.searchParams.get('utm_source')).toBe('facebook');
    expect(location.searchParams.get('utm_medium')).toBe('social');
  }
  expect(db.counts.urlLookups).toBe(1);
  expect(db.counts.channelLookups).toBe(1);
  expect(db.clickInserts.map((c) => c.channel_id)).toEqual([CHANNEL_ROW.id, CHANNEL_ROW.id]);
});

test('cache - KV 故障時退回資料庫照常轉址並記錄點擊', async () => {
  const db = mockDb();
  const broken = {
    get: async () => {
      throw new Error('KV unavailable');
    },
    put: async () => {
      throw new Error('KV unavailable');
    },
    delete: async () => {
      throw new Error('KV unavailable');
    },
  };
  const env = cacheEnv(broken);

  const res = await send(env, '/s/abc123');
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(URL_ROW.original_url);
  expect(db.clickInserts.length).toBe(1);
});

test('cache - 停用網址（PUT is_active=false）後，下一次轉址立即失效', async () => {
  mockDb();
  const env = cacheEnv();
  expect((await send(env, '/s/abc123')).status).toBe(302);

  const put = await send(env, `/api/urls/${URL_ROW.id}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: false }),
  });
  expect(put.status).toBe(200);

  expect((await send(env, '/s/abc123')).status).toBe(404);
});

test('cache - 修改目的網址（PUT original_url）後，下一次轉址使用新網址', async () => {
  mockDb();
  const env = cacheEnv();
  await send(env, '/s/abc123');

  const put = await send(env, `/api/urls/${URL_ROW.id}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ original_url: 'https://example.org/new' }),
  });
  expect(put.status).toBe(200);

  const res = await send(env, '/s/abc123');
  expect(res.headers.get('location')).toBe('https://example.org/new');
});

test('cache - 刪除網址（DELETE /api/urls/:id）後，下一次轉址立即失效', async () => {
  mockDb();
  const env = cacheEnv();
  expect((await send(env, '/s/abc123')).status).toBe(302);

  const del = await send(env, `/api/urls/${URL_ROW.id}`, { method: 'DELETE', headers: AUTH });
  expect(del.status).toBe(200);

  expect((await send(env, '/s/abc123')).status).toBe(404);
});

test('cache - 修改管道 UTM 後，下一次轉址使用新的 UTM', async () => {
  mockDb();
  const env = cacheEnv();
  await send(env, '/s/abc123?g=grp001');

  const put = await send(env, `/api/urls/${URL_ROW.id}/channels/${CHANNEL_ROW.id}`, {
    method: 'PUT',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ utm_source: 'line' }),
  });
  expect(put.status).toBe(200);

  const res = await send(env, '/s/abc123?g=grp001');
  expect(new URL(res.headers.get('location')!).searchParams.get('utm_source')).toBe('line');
});

test('cache - 刪除管道後，下一次轉址不再附加 UTM、不記錄 channel_id', async () => {
  const db = mockDb();
  const env = cacheEnv();
  await send(env, '/s/abc123?g=grp001');

  const del = await send(env, `/api/urls/${URL_ROW.id}/channels/${CHANNEL_ROW.id}`, {
    method: 'DELETE',
    headers: AUTH,
  });
  expect(del.status).toBe(200);

  const res = await send(env, '/s/abc123?g=grp001');
  expect(res.headers.get('location')).toBe(URL_ROW.original_url);
  expect(db.clickInserts.at(-1)?.channel_id).toBeNull();
});
