/**
 * 伺服器產生的 HTML：放進 location / href 的目的網址只允許 http(s)
 */

import { describe, expect, test } from 'vitest';
import { renderAdPage, renderPasswordPage, safeHttpUrl } from './html-templates.ts';

describe('safeHttpUrl', () => {
  test.each(['https://example.com/a?b=1', 'http://example.com', 'HTTPS://EXAMPLE.COM/'])(
    '允許 %s',
    (url) => {
      expect(safeHttpUrl(url)).toBe(url);
    }
  );

  test.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,hi',
    'vbscript:msgbox(1)',
    'chrome-extension://abc/page.html',
    'file:///etc/passwd',
    '/relative/path',
    '//example.com/protocol-relative',
    '',
  ])('拒絕 %j', (url) => {
    expect(safeHttpUrl(url)).toBe('');
  });
});

describe('renderAdPage', () => {
  test('http(s) 目的網址照常顯示並作為導向目標', () => {
    const html = renderAdPage('abc123', 'https://example.com/landing');
    expect(html).toContain("const originalUrl = 'https://example.com/landing'");
    expect(html).toContain('example.com');
  });

  test('非 http(s) 目的網址不會出現在頁面中', () => {
    const html = renderAdPage('abc123', 'javascript:alert(document.cookie)');
    expect(html).toContain("const originalUrl = ''");
    expect(html).not.toContain('alert(document.cookie)');
    expect(html).toContain('無效的目的網址');
  });

  test('API 回應的網址也要先檢查 scheme 才導向', () => {
    const html = renderAdPage('abc123', 'https://example.com/landing');
    expect(html).not.toContain('window.location.href = data.original_url');
    expect(html).toContain('go(data.original_url)');
    expect(html).toContain('function isHttpUrl(u)');
  });
});

describe('renderPasswordPage', () => {
  test('驗證成功後只導向 http(s) 網址', () => {
    const html = renderPasswordPage('abc123');
    expect(html).toContain('function isHttpUrl(u)');
    expect(html).toContain('if (isHttpUrl(data.original_url))');
  });

  test('驗證成功後直接導向目的網址，不再經過 /s/（verify-password 的點擊記錄不會重複計算）', () => {
    const html = renderPasswordPage('abc123', true);
    const script = html.slice(html.lastIndexOf('<script>'));
    expect(script).toContain('window.location.href = data.original_url');
    expect(script).not.toMatch(/location(\.href)?\s*=\s*[`'"]\/s\//);
    expect(script).not.toContain('/s/');
  });
});
