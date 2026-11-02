/**
 * 前端的目的網址 sink（瀏覽器端腳本，這裡只做行為與靜態檢查）
 *
 * - public/js/api.js 的 utils.escapeHtml / utils.isHttpUrl
 * - links.js、analytics.html：原始網址一律跳脫後當文字顯示
 * - admin.js：只有 http(s) 才放進 href，否則顯示跳脫後的文字
 * - password.html：驗證成功後只導向 http(s)
 * - tc-sidebar.js：頭像不用 innerHTML 組字串
 */

import { describe, expect, test } from 'vitest';

const FILES = import.meta.glob<string>(
  ['../public/js/api.js', '../public/js/links.js', '../public/js/admin.js',
    '../public/js/components/tc-sidebar.js', '../public/analytics.html', '../public/password.html'],
  { query: '?raw', import: 'default', eager: true },
);
const read = (path: string): string => {
  const src = FILES[`../public/${path}`];
  if (src === undefined) throw new Error(`missing fixture: ${path}`);
  return src;
};

interface Utils {
  escapeHtml(value: unknown): string;
  isHttpUrl(value: unknown): boolean;
}

/** 在假的 window 下執行 api.js，取出 utils */
function loadUtils(): Utils {
  const src = read('js/api.js');
  return new Function('window', `${src}\nreturn utils`)({ location: { origin: 'https://tcurl.test' } });
}

describe('utils（public/js/api.js）', () => {
  const utils = loadUtils();

  test('escapeHtml 跳脫 & < > " \'', () => {
    expect(utils.escapeHtml('https://x.test/"><img src=x onerror=alert(1)>&\'')).toBe(
      'https://x.test/&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;&#39;',
    );
    expect(utils.escapeHtml(null)).toBe('');
  });

  test.each(['https://example.com/a', 'http://example.com', 'HTTPS://EXAMPLE.COM'])('isHttpUrl 允許 %s', (u) => {
    expect(utils.isHttpUrl(u)).toBe(true);
  });

  test.each([
    'javascript:alert(1)',
    ' JavaScript:alert(1)',
    'data:text/html,hi',
    'chrome-extension://abc/page.html',
    '/relative',
    '',
    null,
    123,
  ])('isHttpUrl 拒絕 %j', (u) => {
    expect(utils.isHttpUrl(u)).toBe(false);
  });
});

describe('靜態檢查', () => {
  test('links.js：原始網址與短碼都經過 escapeHtml', () => {
    const src = read('js/links.js');
    expect(src).toContain('title="${utils.escapeHtml(url.original_url)}"');
    expect(src).toContain('const displayUrl = utils.escapeHtml(');
    expect(src).not.toMatch(/\$\{url\.original_url\}/);
  });

  test('analytics.html：原始網址與短碼都經過 escapeHtml', () => {
    const src = read('analytics.html');
    expect(src).toContain('title="${utils.escapeHtml(url.original_url)}"');
    expect(src).toContain('const displayUrl = utils.escapeHtml(');
    expect(src).not.toMatch(/\$\{url\.original_url\}/);
    expect(src).not.toMatch(/\$\{url\.short_code\}\s*<\/a>/);
  });

  test('admin.js：只有 http(s) 原始網址才放進 href', () => {
    const src = read('js/admin.js');
    expect(src).toContain('utils.isHttpUrl(url.original_url)');
    // href 只出現在 isHttpUrl 為真的分支（三元運算的 ? 那一行）
    const hrefLine = src.split('\n').find((l) => l.includes('href="${escapeHtml(url.original_url)}"')) || '';
    expect(hrefLine.trim().startsWith('?')).toBe(true);
  });

  test('password.html：驗證成功後只導向 http(s)，短碼有 encodeURIComponent', () => {
    const src = read('password.html');
    expect(src).toContain('if (isHttpUrl(data.original_url))');
    expect(src).toContain('encodeURIComponent(shortCode)');
  });

  test('tc-sidebar.js：頭像以 DOM API 建立，且只接受 http(s)', () => {
    const src = read('js/components/tc-sidebar.js');
    expect(src).not.toMatch(/innerHTML\s*=\s*`<img/);
    expect(src).toContain("document.createElement('img')");
    expect(src).toContain('TCSidebar.#isHttpUrl(this.#user.avatar)');
  });
});
