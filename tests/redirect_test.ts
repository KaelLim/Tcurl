/**
 * 短網址重定向測試
 *
 * 針對 /s/:shortCode 的各種狀態進行測試
 * 需要服務在 localhost:3000 運行
 */

import { assertEquals, assertStringIncludes } from '@std/assert';

const BASE = 'http://localhost:3000';

Deno.test('redirect - 不存在的短碼應回傳 404 HTML 頁面', async () => {
  const res = await fetch(`${BASE}/s/this_code_does_not_exist_99`, { redirect: 'manual' });
  assertEquals(res.status, 404);
  const body = await res.text();
  assertStringIncludes(body, '此短網址不存在或已失效');
  assertStringIncludes(body, '<!DOCTYPE html>');
});

Deno.test('redirect - 空短碼不應造成 500', async () => {
  const res = await fetch(`${BASE}/s/`, { redirect: 'manual' });
  const status = res.status;
  await res.body?.cancel();
  assertEquals(status !== 500, true, `空短碼不應造成 500，實際 ${status}`);
});

Deno.test('redirect - 短碼格式異常不應造成 500', async () => {
  const badCodes = [
    'a',           // 太短
    '../etc/passwd', // path traversal attempt
    '<script>',    // XSS attempt
    'a'.repeat(50), // 超長
  ];

  for (const code of badCodes) {
    const res = await fetch(`${BASE}/s/${encodeURIComponent(code)}`, { redirect: 'manual' });
    const status = res.status;
    await res.body?.cancel();
    assertEquals(status !== 500, true, `短碼 "${code}" 不應造成 500，實際回傳 ${status}`);
  }
});

Deno.test('health - 應回傳 ok', async () => {
  const res = await fetch(`${BASE}/health`);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(data.status, 'ok');
});

Deno.test('version - 應回傳版本號', async () => {
  const res = await fetch(`${BASE}/api/version`);
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(typeof data.version, 'string');
  // 版本號應符合 semver 格式
  assertEquals(/^\d+\.\d+\.\d+$/.test(data.version), true, `版本格式異常: ${data.version}`);
});
