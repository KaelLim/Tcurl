/**
 * API 文件的三種檢視：Swagger UI（public/docs/swagger.html；最終安全審查 F6）、
 * RapiDoc（rapidoc.html）、Scalar（scalar.html）（補強輪審查 m2／Minor-4）
 *
 * - 不把貼上的 JWT／API 金鑰長期存在瀏覽器：Swagger `persistAuthorization: false`、
 *   RapiDoc `persist-auth="false"`、Scalar `"persistAuth": false`（true 時會寫進這個網域的 localStorage，
 *   關掉瀏覽器也不會清除）。Scalar 另關掉 agent（它的聊天元件固定保存授權）
 * - 第三方檔案固定確切版本，每個 <script>／<link> 都帶 SRI（integrity）與 crossorigin="anonymous"
 * - 頁面的 CSP 仍允許這些外部檔案與頁內的初始化 script
 *
 * integrity 是以 curl 下載該版本的檔案後 `openssl dgst -sha384 -binary | openssl base64 -A` 算出；
 * 測試不連網路，只檢查格式。升級版本時 integrity 都要重算。
 */

import { describe, expect, test } from 'vitest';

import { workerRequest } from './helpers/test-env.ts';

async function loadPage(path: string) {
  const { res } = await workerRequest(path);
  expect(res.status).toBe(200);
  return { html: await res.text(), csp: res.headers.get('content-security-policy') ?? '' };
}

function loadSwaggerPage() {
  return loadPage('/docs/swagger');
}

interface ExternalTag {
  /** script 或 link */
  kind: string;
  tag: string;
  url: URL;
}

/** 頁面上所有載入外部（http/https）檔案的 <script src> 與 <link href> */
function externalTags(html: string): ExternalTag[] {
  const tags: ExternalTag[] = [];
  for (const [tag, kind] of html.matchAll(/<(script|link)\b[^>]*>/g)) {
    const url = /\b(?:src|href)="(https?:\/\/[^"]+)"/.exec(tag)?.[1];
    if (url) tags.push({ kind, tag, url: new URL(url) });
  }
  return tags;
}

/** CSP 某個指令的來源清單 */
function cspSources(csp: string, directive: string): string[] {
  const entry = csp
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return entry ? entry.slice(1) : [];
}

describe('docs/swagger.html', () => {
  test('persistAuthorization: false（不把貼上的金鑰或 JWT 存進 localStorage）', async () => {
    const { html } = await loadSwaggerPage();
    expect(html).toMatch(/\bpersistAuthorization:\s*false\b/);
    expect(html).not.toMatch(/\bpersistAuthorization:\s*true\b/);
  });

  test('外部檔案只有 swagger-ui-dist 的 css 與兩支 script，以 https 載入、固定同一個確切版本', async () => {
    const { html } = await loadSwaggerPage();
    const tags = externalTags(html);

    expect(tags.map((t) => t.url.pathname.split('/').pop()).sort()).toEqual([
      'swagger-ui-bundle.js',
      'swagger-ui-standalone-preset.js',
      'swagger-ui.css',
    ]);
    const versions = new Set<string>();
    for (const { url } of tags) {
      expect(url.protocol, url.href).toBe('https:');
      const version = /^\/swagger-ui-dist@(\d+\.\d+\.\d+)\/[\w.-]+$/.exec(url.pathname)?.[1];
      expect(version, `${url.href} 要固定確切版本（不能是 @5 這類範圍）`).toBeDefined();
      versions.add(version!);
    }
    expect(versions.size).toBe(1);
  });

  test('每個外部檔案都帶 SRI（sha384）與 crossorigin="anonymous"', async () => {
    const { html } = await loadSwaggerPage();
    const tags = externalTags(html);
    expect(tags.length).toBe(3);

    const hashes = new Set<string>();
    for (const { tag } of tags) {
      const integrity = /\bintegrity="(sha384-[A-Za-z0-9+/]{64})"/.exec(tag)?.[1];
      expect(integrity, tag).toBeDefined();
      hashes.add(integrity!);
      expect(tag).toMatch(/\bcrossorigin="anonymous"/);
    }
    // 三個檔案的雜湊各不相同（防止複製貼上同一個值）
    expect(hashes.size).toBe(3);
  });

  test('CSP 仍允許：script-src 含 script 的網域與 unsafe-inline（頁內初始化），style-src 含 css 的網域', async () => {
    const { html, csp } = await loadSwaggerPage();
    const scriptSrc = cspSources(csp, 'script-src');
    const styleSrc = cspSources(csp, 'style-src');

    expect(scriptSrc).toContain("'unsafe-inline'");
    for (const { kind, url } of externalTags(html)) {
      expect(kind === 'script' ? scriptSrc : styleSrc, url.href).toContain(url.host);
    }
  });
});

/** sha384 SRI（64 字元 base64） */
const SRI = /\bintegrity="(sha384-[A-Za-z0-9+/]{64})"/;

describe.each([
  {
    page: '/docs/rapidoc',
    // unpkg.com/rapidoc@<確切版本>/dist/rapidoc-min.js
    path: /^\/rapidoc@(\d+\.\d+\.\d+)\/dist\/rapidoc-min\.js$/,
  },
  {
    page: '/docs/scalar',
    // cdn.jsdelivr.net/npm/@scalar/api-reference@<確切版本>/dist/browser/standalone.js
    path: /^\/npm\/@scalar\/api-reference@(\d+\.\d+\.\d+)\/dist\/browser\/standalone\.js$/,
  },
])('docs 檢視 $page', ({ page, path }) => {
  test('外部檔案只有一支 script，以 https 載入、固定確切版本', async () => {
    const { html } = await loadPage(page);
    const tags = externalTags(html);

    expect(tags.map((t) => t.kind)).toEqual(['script']);
    const { url } = tags[0];
    expect(url.protocol).toBe('https:');
    expect(path.exec(url.pathname)?.[1], `${url.href} 要固定確切版本（不能沒有版本或用範圍）`).toBeDefined();
  });

  test('script 帶 SRI（sha384）與 crossorigin="anonymous"', async () => {
    const { html } = await loadPage(page);
    const [{ tag }] = externalTags(html);

    expect(SRI.exec(tag)?.[1], tag).toBeDefined();
    expect(tag).toMatch(/\bcrossorigin="anonymous"/);
  });

  test('CSP 仍允許：script-src 含 script 的網域與 unsafe-inline', async () => {
    const { html, csp } = await loadPage(page);
    const scriptSrc = cspSources(csp, 'script-src');

    expect(scriptSrc).toContain("'unsafe-inline'");
    for (const { url } of externalTags(html)) expect(scriptSrc, url.href).toContain(url.host);
  });
});

test('RapiDoc：persist-auth="false"（不把貼上的金鑰或 JWT 存進 localStorage）', async () => {
  const { html } = await loadPage('/docs/rapidoc');
  const element = /<rapi-doc\b[^>]*>/.exec(html)?.[0] ?? '';

  expect(element).toMatch(/\spersist-auth="false"/);
  // 屬性重複時瀏覽器採用第一個：整個元素只能有這一個
  expect(element.match(/persist-auth=/g)).toHaveLength(1);
});

test('Scalar：persistAuth: false、agent 關閉（不把貼上的金鑰或 JWT 存進 localStorage）', async () => {
  const { html } = await loadPage('/docs/scalar');
  const raw = /<script\b[^>]*\bid="api-reference"[^>]*\bdata-configuration='([^']*)'/.exec(html)?.[1];
  expect(raw, 'scalar.html 的 #api-reference 要有 data-configuration').toBeDefined();
  const config = JSON.parse(raw!) as { persistAuth?: unknown; agent?: { disabled?: unknown } };

  expect(config.persistAuth).toBe(false);
  expect(config.agent?.disabled).toBe(true);
});
