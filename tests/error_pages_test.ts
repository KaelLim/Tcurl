/**
 * 錯誤頁面測試
 *
 * 確認各種錯誤狀態回傳正確的 HTML 頁面
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockSupabaseFetch, pgrstNotFound, workerRequest } from './helpers/test-env.ts';

beforeEach(() => {
  // 模擬 PostgREST 查無資料
  mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('error - 404 頁面應包含正確內容', async () => {
  const { res } = await workerRequest('/s/not_exist_code_xyz', { redirect: 'manual' });
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).toContain('此短網址不存在或已失效');
  expect(body).toContain('link_off');
  // 不應包含返回首頁
  expect(body.includes('返回首頁'), '404 頁面不應包含返回首頁').toBe(false);
});

test('error - 404 頁面不應洩露系統資訊', async () => {
  const { res } = await workerRequest('/s/not_exist_code_xyz', { redirect: 'manual' });
  const body = await res.text();
  // 不應包含堆疊追蹤或技術細節
  expect(body.includes('stack'), '不應包含 stack trace').toBe(false);
  expect(body.includes('Error:'), '不應包含錯誤物件').toBe(false);
  expect(body.includes('supabase'), '不應洩露 supabase').toBe(false);
});

test('error - ad 頁面不存在的短碼應回傳 404 HTML', async () => {
  const { res } = await workerRequest('/ad/not_exist_code_xyz');
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).toContain('此短網址不存在或已失效');
});

test('error - Supabase 無法連線（無效金鑰）時轉址頁仍回 404 而非 500', async () => {
  vi.unstubAllGlobals();
  mockSupabaseFetch(); // 全部回 401 Invalid API key
  const { res } = await workerRequest('/s/anything', { redirect: 'manual' });
  expect(res.status).toBe(404);
  await res.body?.cancel();
});
