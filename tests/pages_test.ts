/**
 * HTML 頁面路由測試
 *
 * 確認所有頁面能正常回傳 200 和 HTML 內容
 */

import { assertEquals, assertStringIncludes } from '@std/assert';

const BASE = 'http://localhost:3000';

const pages = [
  { path: '/links', title: 'links' },
  { path: '/analytics', title: 'analytics' },
  { path: '/feedback', title: 'feedback' },
  { path: '/docs', title: 'docs' },
  { path: '/changelog', title: 'changelog' },
  { path: '/login', title: 'login' },
];

for (const { path, title } of pages) {
  Deno.test(`pages - ${path} 應回傳 200 HTML`, async () => {
    const res = await fetch(`${BASE}${path}`);
    assertEquals(res.status, 200, `${path} 回傳 ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    assertStringIncludes(contentType, 'text/html');
    const body = await res.text();
    assertStringIncludes(body, '<!DOCTYPE html>', `${path} 不包含 DOCTYPE`);
  });
}

Deno.test('pages - /edit/:id 應回傳 200（不驗證 ID）', async () => {
  const res = await fetch(`${BASE}/edit/00000000-0000-0000-0000-000000000000`);
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, '<!DOCTYPE html>');
});

Deno.test('pages - /analytics/:id 應回傳 200', async () => {
  const res = await fetch(`${BASE}/analytics/00000000-0000-0000-0000-000000000000`);
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, '<!DOCTYPE html>');
});

Deno.test('pages - /feedback/:id 應回傳 200', async () => {
  const res = await fetch(`${BASE}/feedback/00000000-0000-0000-0000-000000000000`);
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, '<!DOCTYPE html>');
});
