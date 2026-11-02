/**
 * 點擊記錄測試（取代舊版 Nginx log watcher）
 *
 * 每次轉址都在 Worker 內以 executionCtx.waitUntil 背景寫入 url_clicks，
 * 並維持 event_type（link_click / qr_scan）、channel_id（?g=）與 UTM 參數的既有語意。
 */

import { afterEach, expect, test, vi } from 'vitest';
import {
  jsonResponse,
  mockSupabaseFetch,
  pgrstNotFound,
  workerRequest,
  type SupabaseCall,
} from './helpers/test-env.ts';

const URL_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  short_code: 'abc123',
  original_url: 'https://example.com/landing?x=1',
  is_active: true,
  expires_at: null,
  password_protected: false,
  password_hash: null,
};

const CHANNEL_ROW = {
  id: '22222222-2222-2222-2222-222222222222',
  url_id: URL_ROW.id,
  group_key: 'grp001',
  name: 'FB',
  utm_source: 'facebook',
  utm_medium: 'social',
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
};

interface Options {
  urlRow?: Record<string, unknown>;
  /** 讓 url_clicks 寫入卡住，直到呼叫 release() */
  holdClickInsert?: boolean;
}

function mockDb({ urlRow = URL_ROW, holdClickInsert = false }: Options = {}) {
  const clickInserts: Array<Record<string, unknown>> = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const handler = async (call: SupabaseCall) => {
    const { pathname, searchParams } = call.url;
    if (call.method === 'GET' && pathname === '/rest/v1/urls') {
      return searchParams.get('short_code') === `eq.${urlRow.short_code}`
        ? jsonResponse(urlRow)
        : pgrstNotFound();
    }
    if (call.method === 'GET' && pathname === '/rest/v1/url_channels') {
      return searchParams.get('group_key') === `eq.${CHANNEL_ROW.group_key}` &&
        searchParams.get('url_id') === `eq.${urlRow.id}`
        ? jsonResponse(CHANNEL_ROW)
        : pgrstNotFound();
    }
    if (call.method === 'POST' && pathname === '/rest/v1/url_clicks') {
      if (holdClickInsert) await held;
      clickInserts.push(JSON.parse(call.body || '{}'));
      return new Response(null, { status: 201 });
    }
    return undefined;
  };

  const mock = mockSupabaseFetch(handler);
  return { ...mock, clickInserts, release };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('click - 一般點擊：302 轉址並以 waitUntil 記錄 link_click', async () => {
  const db = mockDb();
  const { res, waitUntil, settle } = await workerRequest('/s/abc123', {
    redirect: 'manual',
    headers: { 'User-Agent': 'test-agent' },
  });

  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(URL_ROW.original_url);
  expect(res.headers.get('cache-control')).toBe('no-cache');
  // 點擊寫入交給 waitUntil（另有一次是轉址快取寫入）
  expect(waitUntil).toHaveBeenCalled();

  await settle();
  expect(db.clickInserts).toEqual([
    { url_id: URL_ROW.id, user_agent: 'test-agent', event_type: 'link_click', channel_id: null },
  ]);
});

test('click - ?qr=1 與 ?qr=true 記錄為 qr_scan', async () => {
  for (const qr of ['1', 'true']) {
    const db = mockDb();
    const { res, settle } = await workerRequest(`/s/abc123?qr=${qr}`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    await settle();
    expect(db.clickInserts.map((c) => c.event_type)).toEqual(['qr_scan']);
    vi.unstubAllGlobals();
  }
});

test('click - ?g= 對應管道：附加 UTM 參數並記錄 channel_id', async () => {
  const db = mockDb();
  const { res, settle } = await workerRequest(`/s/abc123?g=${CHANNEL_ROW.group_key}&qr=1`, {
    redirect: 'manual',
  });

  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  expect(location.origin + location.pathname).toBe('https://example.com/landing');
  expect(location.searchParams.get('x')).toBe('1');
  expect(location.searchParams.get('utm_source')).toBe('facebook');
  expect(location.searchParams.get('utm_medium')).toBe('social');
  expect(location.searchParams.has('utm_campaign')).toBe(false);

  await settle();
  expect(db.clickInserts).toEqual([
    { url_id: URL_ROW.id, user_agent: null, event_type: 'qr_scan', channel_id: CHANNEL_ROW.id },
  ]);
});

test('click - ?g= 查無管道時視為一般點擊（channel_id 為 null、不加 UTM）', async () => {
  const db = mockDb();
  const { res, settle } = await workerRequest('/s/abc123?g=unknown', { redirect: 'manual' });
  expect(res.status).toBe(302);
  expect(res.headers.get('location')).toBe(URL_ROW.original_url);
  await settle();
  expect(db.clickInserts).toEqual([
    { url_id: URL_ROW.id, user_agent: null, event_type: 'link_click', channel_id: null },
  ]);
});

test('click - 寫入點擊不阻塞 302 回應', async () => {
  const db = mockDb({ holdClickInsert: true });
  const { res, settle } = await workerRequest('/s/abc123', { redirect: 'manual' });
  // 寫入仍卡住時回應已送出
  expect(res.status).toBe(302);
  expect(db.clickInserts.length).toBe(0);

  db.release();
  await settle();
  expect(db.clickInserts.length).toBe(1);
});

test('click - 寫入失敗不影響轉址', async () => {
  mockSupabaseFetch((call) => {
    if (call.method === 'GET' && call.url.pathname === '/rest/v1/urls') return jsonResponse(URL_ROW);
    if (call.url.pathname === '/rest/v1/url_clicks') {
      return jsonResponse({ code: '42501', message: 'permission denied' }, 403);
    }
    return undefined;
  });
  const { res, settle } = await workerRequest('/s/abc123', { redirect: 'manual' });
  expect(res.status).toBe(302);
  await expect(settle()).resolves.toBeDefined();
});

test('click - 密碼保護的短網址顯示密碼頁且不記錄點擊', async () => {
  const db = mockDb({
    urlRow: { ...URL_ROW, password_protected: true, password_hash: '$2a$10$abcdefghijklmnopqrstuv' },
  });
  const { res, settle } = await workerRequest('/s/abc123', { redirect: 'manual' });
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).not.toContain(URL_ROW.original_url);
  await settle();
  expect(db.clickInserts.length).toBe(0);
});

test('click - 已過期的短網址顯示過期頁且不記錄點擊', async () => {
  const db = mockDb({ urlRow: { ...URL_ROW, expires_at: '2000-01-01T00:00:00Z' } });
  const { res, settle } = await workerRequest('/s/abc123', { redirect: 'manual' });
  expect(res.status).toBe(200);
  await res.body?.cancel();
  await settle();
  expect(db.clickInserts.length).toBe(0);
});
