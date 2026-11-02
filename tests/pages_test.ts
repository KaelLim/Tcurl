/**
 * HTML 頁面路由測試
 *
 * 確認所有頁面能正常回傳 200 和 HTML 內容（HTML 由 ASSETS binding 讀取後注入版本號）
 */

import { expect, test } from 'vitest';
import { APP_VERSION } from '../src/utils/asset-version.ts';
import { workerRequest } from './helpers/test-env.ts';

const pages = [
  { path: '/links', title: 'links' },
  { path: '/analytics', title: 'analytics' },
  { path: '/feedback', title: 'feedback' },
  { path: '/docs', title: 'docs' },
  { path: '/changelog', title: 'changelog' },
  { path: '/login', title: 'login' },
  { path: '/ui-kit', title: 'ui-kit' },
  { path: '/admin', title: 'admin' },
  { path: '/r', title: 'room' },
  { path: '/', title: 'index' },
  { path: '/login.html', title: 'login.html' },
];

for (const { path } of pages) {
  test(`pages - ${path} 應回傳 200 HTML`, async () => {
    const { res } = await workerRequest(path);
    expect(res.status, `${path} 回傳 ${res.status}`).toBe(200);
    const contentType = res.headers.get('content-type') || '';
    expect(contentType).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const body = await res.text();
    expect(body, `${path} 不包含 DOCTYPE`).toContain('<!DOCTYPE html>');
  });
}

test('pages - /edit/:id 應回傳 200（不驗證 ID）', async () => {
  const { res } = await workerRequest('/edit/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('<!DOCTYPE html>');
});

test('pages - /analytics/:id 應回傳 200', async () => {
  const { res } = await workerRequest('/analytics/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('<!DOCTYPE html>');
});

test('pages - /feedback/:id 應回傳 200', async () => {
  const { res } = await workerRequest('/feedback/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body).toContain('<!DOCTYPE html>');
});

// ============================================================
// 版本號注入與靜態檔 fallback（取代舊版自寫靜態檔處理）
// ============================================================

test('pages - HTML 的 /js/ 引用會加上 ?v=版本號', async () => {
  const { res } = await workerRequest('/links');
  const body = await res.text();
  expect(body).toMatch(new RegExp(`src="/js/[^"]+\\?v=${APP_VERSION.replace(/\./g, '\\.')}"`));
  expect(body).not.toMatch(/src="\/js\/[^"?]+"/);
});

test('pages - inline module 的 import \'/js/...\' 也會加上 ?v=版本號（tc-sidebar.js 等元件）', async () => {
  const { res } = await workerRequest('/links');
  const body = await res.text();
  const v = APP_VERSION.replace(/\./g, '\\.');
  expect(body).toMatch(new RegExp(`import '/js/components/tc-sidebar\\.js\\?v=${v}'`));
  expect(body).not.toMatch(/import '\/js\/[^'?]+'/);
});

test('version - changelog.json 第一筆與 package.json 版本一致', async () => {
  const { res } = await workerRequest('/changelog.json');
  const changelog = (await res.json()) as Array<{ version: string }>;
  expect(changelog[0].version).toBe(APP_VERSION);
});

test('pages - 不存在的無副檔名路徑走 SPA fallback（index.html）', async () => {
  const { res } = await workerRequest('/some/unknown/path');
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('<!DOCTYPE html>');
});

test('pages - 不存在的檔案回傳 404', async () => {
  const { res } = await workerRequest('/js/does-not-exist.js');
  expect(res.status).toBe(404);
  await res.body?.cancel();
});

test('pages - 路徑穿越無法讀到 public/ 以外的檔案', async () => {
  for (const path of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json']) {
    const { res } = await workerRequest(path);
    const body = await res.text();
    expect(body.includes('"devDependencies"'), `${path} 不應讀到 package.json`).toBe(false);
  }
});

test('pages - 非 HTML 檔案經 Worker 時原樣回傳', async () => {
  const { res } = await workerRequest('/changelog.json');
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type') || '').toContain('application/json');
  await res.body?.cancel();
});

test('pages - CSP connect-src 使用請求 env 的 SUPABASE_URL', async () => {
  const { res } = await workerRequest('/links');
  await res.body?.cancel();
  const csp = res.headers.get('content-security-policy') || '';
  expect(csp).toMatch(/connect-src [^;]*https:\/\/supabase\.test/);
  // 舊自架 Supabase 與 Keycloak 網域已移除
  expect(csp).not.toContain('tzuchi-org.tw');
  expect(csp).not.toContain('auth.tzuchi.net');
});
