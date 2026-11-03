/**
 * 「由 API：〈名稱〉建立」標示（spec §6.7；public/js/links.js、public/js/edit.js、public/js/api.js）
 *
 * 前端腳本是瀏覽器端的 classic script：這裡以最小的假 DOM、假 fetch、假 Supabase client 執行它們，驗證
 * - 我的連結列表：GET /api/urls 的每一筆帶 api_key_name 時顯示標示，已撤銷加註；名稱經 escapeHtml
 * - api.getUrlApiKeyInfo：以 Bearer 呼叫後端 GET /api/urls/:id，只回傳 { api_key_name, api_key_revoked }
 * - 編輯頁：Supabase 讀到 api_key_id 非 null 才向後端取名稱並以 textContent 顯示；
 *   網頁建立的短網址不多打請求；取名稱失敗不影響頁面載入
 * - 編輯頁「客製化 QR Code」對話框：qr_code_options 可由金鑰寫入（寫入者不是觀看的負責同仁），
 *   色碼放進 innerHTML 前一律跳脫（後端另有格式檢查，見 tests/qr_code_options_test.ts）
 */

import { describe, expect, test, vi } from 'vitest';

const FILES = import.meta.glob<string>(
  ['../public/js/api.js', '../public/js/links.js', '../public/js/edit.js', '../public/edit.html'],
  { query: '?raw', import: 'default', eager: true },
);
const read = (path: string): string => {
  const src = FILES[`../public/${path}`];
  if (src === undefined) throw new Error(`missing fixture: ${path}`);
  return src;
};

const ORIGIN = 'https://tcurl.test';
const URL_ID = '55555555-5555-4555-8555-555555555555';
const KEY_ID = '11111111-1111-4111-8111-111111111111';
const XSS = '"><img src=x onerror=alert(1)>';

const ACTIVE_LABEL = '由 API：〈報名系統〉建立';
const REVOKED_LABEL = '由 API：〈報名系統〉（已撤銷）建立';

// ------------------------------------------------------------
// 假 DOM（只實作這些腳本在載入與 loadUrlData / createUrlRow 路徑上用到的部分）
// ------------------------------------------------------------

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

class FakeElement {
  readonly classes = new Set<string>();
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  parent: FakeElement | null = null;
  className = '';
  value = '';
  placeholder = '';
  type = '';
  min = '';
  checked = false;
  disabled = false;
  onclick: unknown = null;
  #text = '';
  #html: string | null = null;

  constructor(readonly tagName: string) {}

  readonly classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
  };

  get textContent(): string {
    return this.#text;
  }
  set textContent(v: unknown) {
    this.#text = v == null ? '' : String(v);
    this.#html = null;
  }

  /** 設定時原樣保存；未設定時是 textContent 的 HTML 序列化（瀏覽器只跳脫 & < >） */
  get innerHTML(): string {
    return this.#html ?? escapeText(this.#text);
  }
  set innerHTML(v: unknown) {
    this.#html = String(v);
    this.#text = '';
  }

  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    this.parent = null;
  }
  addEventListener(): void {}
  setAttribute(): void {}
  focus(): void {}
  querySelector(): FakeElement {
    return new FakeElement('span');
  }
  querySelectorAll(): FakeElement[] {
    return [];
  }
}

function fakeDocument() {
  const elements = new Map<string, FakeElement>();
  return {
    body: new FakeElement('body'),
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, new FakeElement(`#${id}`));
      return elements.get(id)!;
    },
    querySelectorAll: () => [],
  };
}

const silentConsole = () => ({
  log: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
});

/** 等目前排定的 Promise 都跑完（標示是背景載入，不阻塞 loadUrlData） */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

interface FetchCall {
  method: string;
  path: string;
  auth: string | undefined;
  cache: string | undefined;
}

/** 假後端：記錄請求，依路徑回應 */
function fakeBackend(urlDetail: () => Response) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(
    async (input: string, init: { method?: string; headers?: Record<string, string>; cache?: string } = {}) => {
      const { pathname } = new URL(input, ORIGIN);
      calls.push({
        method: init.method ?? 'GET',
        path: pathname,
        auth: init.headers?.Authorization,
        cache: init.cache,
      });
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      if (pathname === `/api/urls/${URL_ID}/stats`) return json({ total: { total_clicks: 3 }, daily: [] });
      if (pathname === `/api/urls/${URL_ID}/channels`) return json([]);
      if (pathname === `/api/urls/${URL_ID}`) return urlDetail();
      return json({ error: 'Not found' }, 404);
    },
  );
  return { fetch, calls };
}

/** GET /api/urls/:id 的回應（後端 select('*') 再加上金鑰資訊；欄位比標示需要的多） */
function urlDetailResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: URL_ID,
      short_code: 'abc123',
      original_url: 'https://example.com/',
      password_hash: '$2a$10$secret',
      api_key_id: KEY_ID,
      ...extra,
    }),
    { status: 200 },
  );
}

interface ApiModule {
  getUrlApiKeyInfo(id: string): Promise<unknown>;
}

/** 在假 window 下執行 api.js，取出 api */
function loadApi(fetch: unknown, token: string | null = 'user-jwt'): ApiModule {
  const window = {
    location: { origin: ORIGIN },
    auth: { getAccessToken: async () => token },
  };
  return new Function('window', 'fetch', `${read('js/api.js')}\nreturn api`)(window, fetch);
}

// ------------------------------------------------------------
// 我的連結（links.js）
// ------------------------------------------------------------

interface UrlListRow {
  id: string;
  short_code: string;
  original_url: string;
  clicks: number;
  created_at: string;
  api_key_id?: string | null;
  api_key_name?: string | null;
  api_key_revoked?: boolean;
}

function listRow(overrides: Partial<UrlListRow> = {}): UrlListRow {
  return {
    id: URL_ID,
    short_code: 'abc123',
    original_url: 'https://example.com/',
    clicks: 0,
    created_at: '2026-11-03T01:00:00Z',
    api_key_id: null,
    api_key_name: null,
    api_key_revoked: false,
    ...overrides,
  };
}

function loadLinks(): { createUrlRow(url: UrlListRow): FakeElement } {
  const window = { location: { origin: ORIGIN, href: '' } };
  return new Function(
    'window',
    'document',
    'console',
    `${read('js/api.js')}\n${read('js/links.js')}\nreturn { createUrlRow }`,
  )(window, fakeDocument(), silentConsole());
}

describe('我的連結：createUrlRow', () => {
  test('金鑰建立的短網址顯示「由 API：〈名稱〉建立」', () => {
    const { createUrlRow } = loadLinks();
    const row = createUrlRow(listRow({ api_key_id: KEY_ID, api_key_name: '報名系統' }));
    expect(row.innerHTML).toContain(ACTIVE_LABEL);
    expect(row.innerHTML).not.toContain('已撤銷');
  });

  test('金鑰已撤銷時顯示「由 API：〈名稱〉（已撤銷）建立」', () => {
    const { createUrlRow } = loadLinks();
    const row = createUrlRow(
      listRow({ api_key_id: KEY_ID, api_key_name: '報名系統', api_key_revoked: true }),
    );
    expect(row.innerHTML).toContain(REVOKED_LABEL);
  });

  test('金鑰名稱經 escapeHtml 才放進 innerHTML', () => {
    const { createUrlRow } = loadLinks();
    const row = createUrlRow(listRow({ api_key_id: KEY_ID, api_key_name: XSS }));
    expect(row.innerHTML).toContain('由 API：〈&quot;&gt;&lt;img src=x onerror=alert(1)&gt;〉建立');
    expect(row.innerHTML).not.toContain('<img');
  });

  test.each([
    ['網頁建立（api_key_name 為 null）', listRow()],
    ['回應沒有金鑰欄位', (({ api_key_id, api_key_name, api_key_revoked, ...rest }) => rest)(listRow())],
  ])('%s：不顯示標示', (_name, url) => {
    const { createUrlRow } = loadLinks();
    expect(createUrlRow(url as UrlListRow).innerHTML).not.toContain('由 API');
  });
});

// ------------------------------------------------------------
// api.getUrlApiKeyInfo（api.js）
// ------------------------------------------------------------

describe('api.getUrlApiKeyInfo', () => {
  test('以 Bearer 呼叫後端 GET /api/urls/:id，只回傳金鑰名稱與是否已撤銷', async () => {
    const { fetch, calls } = fakeBackend(() =>
      urlDetailResponse({ api_key_name: '報名系統', api_key_revoked: true }),
    );
    const api = loadApi(fetch);

    await expect(api.getUrlApiKeyInfo(URL_ID)).resolves.toEqual({
      api_key_name: '報名系統',
      api_key_revoked: true,
    });
    expect(calls).toEqual([
      { method: 'GET', path: `/api/urls/${URL_ID}`, auth: 'Bearer user-jwt', cache: 'no-store' },
    ]);
  });

  test('後端沒有金鑰資訊（網頁建立，或查詢金鑰失敗）時回傳 null 名稱', async () => {
    const { fetch } = fakeBackend(() => urlDetailResponse({ api_key_id: null }));
    await expect(loadApi(fetch).getUrlApiKeyInfo(URL_ID)).resolves.toEqual({
      api_key_name: null,
      api_key_revoked: false,
    });
  });

  test('後端回應失敗時拋錯', async () => {
    const { fetch } = fakeBackend(() => new Response('{"error":"URL not found"}', { status: 404 }));
    await expect(loadApi(fetch).getUrlApiKeyInfo(URL_ID)).rejects.toThrow();
  });

  test('未登入時拋錯，不送請求', async () => {
    const { fetch } = fakeBackend(() => urlDetailResponse());
    await expect(loadApi(fetch, null).getUrlApiKeyInfo(URL_ID)).rejects.toThrow('請先登入');
    expect(fetch).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// 編輯頁（edit.js）
// ------------------------------------------------------------

/** 假 Supabase client：只支援 api.getUrl 的 from('urls').select('*').eq('id', id).single() */
function fakeSupabase(row: Record<string, unknown>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          single: async () =>
            table === 'urls' && id === row.id
              ? { data: row, error: null }
              : { data: null, error: { message: 'not found' } },
        }),
      }),
    }),
  };
}

function loadEdit(urlRow: Record<string, unknown>, urlDetail: () => Response) {
  const document = fakeDocument();
  const { fetch, calls } = fakeBackend(urlDetail);
  const console = silentConsole();
  const setTimeout = vi.fn();
  const window: Record<string, unknown> = {
    location: { origin: ORIGIN, pathname: `/edit/${URL_ID}`, search: '', href: `${ORIGIN}/edit/${URL_ID}` },
    auth: {
      getAccessToken: async () => 'user-jwt',
      getClient: () => fakeSupabase(urlRow),
      getUser: async () => ({ id: 'owner' }),
    },
  };
  class QRCodeStyling {
    append(): void {}
  }

  const page = new Function(
    'window',
    'document',
    'fetch',
    'console',
    'setTimeout',
    'QRCodeStyling',
    `${read('js/api.js')}\n${read('js/edit.js')}\nreturn { loadUrlData, openClientCustomizeModal }`,
  )(window, document, fetch, console, setTimeout, QRCodeStyling) as {
    loadUrlData(): Promise<void>;
    openClientCustomizeModal(): void;
  };

  const label = document.getElementById('apiKeyLabel');
  label.classList.add('hidden'); // 與 edit.html 的初始狀態相同
  return { page, document, calls, console, setTimeout, label };
}

/** Supabase 直接讀到的 urls 資料列（RLS；不含金鑰名稱） */
function urlRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: URL_ID,
    short_code: 'abc123',
    original_url: 'https://example.com/',
    created_at: '2026-11-03T01:00:00Z',
    is_active: true,
    password_protected: false,
    expires_at: null,
    qr_code_options: null,
    api_key_id: KEY_ID,
    ...overrides,
  };
}

describe('編輯頁：loadUrlData', () => {
  test('edit.html 有放標示的元素，預設隱藏', () => {
    expect(read('edit.html')).toMatch(/<[a-z]+ id="apiKeyLabel" class="hidden[ "]/);
  });

  test('api_key_id 非 null：向後端取名稱並以 textContent 顯示「由 API：〈名稱〉建立」', async () => {
    const ctx = loadEdit(urlRow(), () =>
      urlDetailResponse({ api_key_name: '報名系統', api_key_revoked: false }),
    );

    await ctx.page.loadUrlData();
    await flush();

    expect(ctx.calls).toContainEqual({
      method: 'GET',
      path: `/api/urls/${URL_ID}`,
      auth: 'Bearer user-jwt',
      cache: 'no-store',
    });
    expect(ctx.label.textContent).toBe(ACTIVE_LABEL);
    expect(ctx.label.classList.contains('hidden')).toBe(false);
    expect(ctx.setTimeout).not.toHaveBeenCalled(); // 沒有因錯誤導回 /links
  });

  test('金鑰已撤銷時顯示「由 API：〈名稱〉（已撤銷）建立」', async () => {
    const ctx = loadEdit(urlRow(), () =>
      urlDetailResponse({ api_key_name: '報名系統', api_key_revoked: true }),
    );

    await ctx.page.loadUrlData();
    await flush();

    expect(ctx.label.textContent).toBe(REVOKED_LABEL);
    expect(ctx.label.classList.contains('hidden')).toBe(false);
  });

  test('金鑰名稱以文字顯示，不當 HTML 解析', async () => {
    const ctx = loadEdit(urlRow(), () => urlDetailResponse({ api_key_name: XSS, api_key_revoked: false }));

    await ctx.page.loadUrlData();
    await flush();

    expect(ctx.label.textContent).toBe(`由 API：〈${XSS}〉建立`);
    expect(ctx.label.innerHTML).not.toContain('<img');
  });

  test('網頁建立的短網址（api_key_id 為 null）：不向後端多打請求，不顯示標示', async () => {
    const ctx = loadEdit(urlRow({ api_key_id: null }), () => urlDetailResponse());

    await ctx.page.loadUrlData();
    await flush();

    expect(ctx.calls.map((c) => c.path)).not.toContain(`/api/urls/${URL_ID}`);
    expect(ctx.label.textContent).toBe('');
    expect(ctx.label.classList.contains('hidden')).toBe(true);
  });

  test('取金鑰名稱失敗：不顯示標示，頁面照常載入（不導回 /links）', async () => {
    const ctx = loadEdit(urlRow(), () => new Response('{"error":"boom"}', { status: 500 }));

    await ctx.page.loadUrlData();
    await flush();

    expect(ctx.label.classList.contains('hidden')).toBe(true);
    expect(ctx.document.getElementById('shortCode').value).toBe('abc123');
    expect(ctx.document.getElementById('loadingOverlay').classList.contains('hidden')).toBe(true);
    expect(ctx.setTimeout).not.toHaveBeenCalled();
    expect(ctx.console.error).toHaveBeenCalled();
  });
});

describe('編輯頁：客製化 QR Code 對話框（qr_code_options 可由金鑰寫入）', () => {
  /** loadUrlData 讀到 qr_code_options → 產生 QR Code → 按「客製化 QR Code」→ 對話框的 HTML */
  async function openCustomizeModal(qrCodeOptions: Record<string, unknown>) {
    const ctx = loadEdit(urlRow({ api_key_id: null, qr_code_options: qrCodeOptions }), () =>
      urlDetailResponse(),
    );
    await ctx.page.loadUrlData();
    await flush();
    ctx.page.openClientCustomizeModal();
    const modal = ctx.document.body.children.at(-1);
    expect((modal as unknown as { id: string }).id).toBe('customizeModal');
    return modal!.innerHTML;
  }

  test('dotsColor 夾帶 HTML（edit.js 讀回 → 對話框的 <input value>）→ 跳脫，不會變成元素', async () => {
    const html = await openCustomizeModal({ dotsColor: '"><img src=x onerror=alert(document.domain)>' });

    expect(html).not.toContain('<img');
    expect(html).toContain(
      'id="qrDotsColor" value="&quot;&gt;&lt;img src=x onerror=alert(document.domain)&gt;"',
    );
  });

  test('正常的設定照原值顯示', async () => {
    const html = await openCustomizeModal({ dotsColor: '#713d3d', bgColor: '#ffffff', bgOpacity: 50 });

    expect(html).toContain('id="qrDotsColor" value="#713d3d"');
    expect(html).toContain('id="qrBgColor" value="#ffffff"');
    expect(html).toContain('id="qrBgOpacity" min="0" max="100" value="50"');
  });

  test('靜態檢查：對話框的色碼都經 escapeHtml', () => {
    const src = read('js/edit.js');
    expect(src).toContain('value="${escapeHtml(dotsColor)}"');
    expect(src).toContain('value="${escapeHtml(bgColorData.hex)}"');
    expect(src).not.toMatch(/value="\$\{(dotsColor|bgColorData\.hex)\}"/);
  });
});
