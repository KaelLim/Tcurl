/**
 * 短網址重定向測試
 *
 * 針對 /s/:shortCode 的各種狀態進行測試
 */

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockSupabaseFetch, pgrstNotFound, workerRequest } from './helpers/test-env.ts';

beforeEach(() => {
  mockSupabaseFetch((call) => (call.url.pathname.startsWith('/rest/v1/') ? pgrstNotFound() : undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test('redirect - 不存在的短碼應回傳 404 HTML 頁面', async () => {
  const { res } = await workerRequest('/s/this_code_does_not_exist_99', { redirect: 'manual' });
  expect(res.status).toBe(404);
  const body = await res.text();
  expect(body).toContain('此短網址不存在或已失效');
  expect(body).toContain('<!DOCTYPE html>');
});

test('redirect - 空短碼不應造成 500', async () => {
  const { res } = await workerRequest('/s/', { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  expect(status, `空短碼不應造成 500，實際 ${status}`).not.toBe(500);
});

test('redirect - 短碼格式異常不應造成 500', async () => {
  const badCodes = [
    'a', // 太短
    '../etc/passwd', // path traversal attempt
    '<script>', // XSS attempt
    'a'.repeat(50), // 超長
  ];

  for (const code of badCodes) {
    const { res } = await workerRequest(`/s/${encodeURIComponent(code)}`, { redirect: 'manual' });
    const status = res.status;
    await res.body?.cancel();
    expect(status, `短碼 "${code}" 不應造成 500，實際回傳 ${status}`).not.toBe(500);
  }
});

test('health - 應回傳 ok', async () => {
  const { res } = await workerRequest('/health');
  expect(res.status).toBe(200);
  const data = (await res.json()) as { status: string };
  expect(data.status).toBe('ok');
});

test('version - 應回傳版本號', async () => {
  const { res } = await workerRequest('/api/version');
  expect(res.status).toBe(200);
  const data = (await res.json()) as { version: unknown };
  expect(typeof data.version).toBe('string');
  // 版本號應符合 semver 格式
  expect(/^\d+\.\d+\.\d+$/.test(data.version as string), `版本格式異常: ${data.version}`).toBe(true);
});
