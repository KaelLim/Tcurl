/**
 * 錯誤頁面測試
 *
 * 確認各種錯誤狀態回傳正確的 HTML 頁面
 */

import { assertEquals, assertStringIncludes } from '@std/assert';

const BASE = 'http://localhost:3000';

Deno.test('error - 404 頁面應包含正確內容', async () => {
  const res = await fetch(`${BASE}/s/not_exist_code_xyz`, { redirect: 'manual' });
  assertEquals(res.status, 404);
  const body = await res.text();
  assertStringIncludes(body, '此短網址不存在或已失效');
  assertStringIncludes(body, 'link_off');
  // 不應包含返回首頁
  assertEquals(body.includes('返回首頁'), false, '404 頁面不應包含返回首頁');
});

Deno.test('error - 404 頁面不應洩露系統資訊', async () => {
  const res = await fetch(`${BASE}/s/not_exist_code_xyz`, { redirect: 'manual' });
  const body = await res.text();
  // 不應包含堆疊追蹤或技術細節
  assertEquals(body.includes('stack'), false, '不應包含 stack trace');
  assertEquals(body.includes('Error:'), false, '不應包含錯誤物件');
  assertEquals(body.includes('supabase'), false, '不應洩露 supabase');
});

Deno.test('error - ad 頁面不存在的短碼應回傳 404 HTML', async () => {
  const res = await fetch(`${BASE}/ad/not_exist_code_xyz`);
  assertEquals(res.status, 404);
  const body = await res.text();
  assertStringIncludes(body, '此短網址不存在或已失效');
});
