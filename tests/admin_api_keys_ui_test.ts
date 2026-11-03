/**
 * 後台「API 金鑰」分頁（public/admin.html、public/js/admin.js；spec §6.6）
 *
 * admin.js 是瀏覽器端腳本：這裡以最小的假 DOM（只實作 admin.js 用到的部分）、假 fetch 執行它，驗證
 * - 伺服器回傳的字串插入 innerHTML 前都經過 escapeHtml
 * - 完整金鑰只出現在發放後的對話框：不進 adminState、console、localStorage；關閉即從 DOM 移除
 * - 發放／撤銷／編輯送出的請求（撤銷要二次確認、轉移負責同仁要確認、編輯只送有變更的欄位）
 * - admin.js 用到的元素 id 都存在於 admin.html
 */

import { describe, expect, test, vi } from 'vitest';

const FILES = import.meta.glob<string>(['../public/js/admin.js', '../public/admin.html'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const read = (path: string): string => {
  const src = FILES[`../public/${path}`];
  if (src === undefined) throw new Error(`missing fixture: ${path}`);
  return src;
};

const FULL_KEY = 'tcurl_sk_Q2xhdWRlVGVzdEtleU9ubHlGb3JVbml0VGVzdHNYWVo';
const KEY_ID = '11111111-1111-4111-8111-111111111111';
const NEW_KEY_ID = '33333333-3333-4333-8333-333333333333';
const XSS = '"><img src=x onerror=alert(1)>';

// ------------------------------------------------------------
// 假 DOM
// ------------------------------------------------------------

const escapeText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Listener = (event: unknown) => unknown;

class FakeElement {
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Listener[]>();
  readonly classes = new Set<string>();
  className = '';
  value = '';
  type = '';
  checked = false;
  disabled = false;
  resetCount = 0;
  focused = false;
  #text = '';
  #html: string | null = null;

  constructor(readonly tagName: string) {}

  readonly classList = {
    add: (c: string) => void this.classes.add(c),
    remove: (c: string) => void this.classes.delete(c),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on?: boolean) => {
      const next = on ?? !this.classes.has(c);
      if (next) this.classes.add(c);
      else this.classes.delete(c);
      return next;
    },
  };

  get textContent(): string {
    return this.#text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: unknown) {
    this.#text = v == null ? '' : String(v);
    this.#html = null;
    this.children.length = 0;
  }

  /** 設定時原樣保存；未設定時是 textContent 的 HTML 序列化（瀏覽器只跳脫 & < >） */
  get innerHTML(): string {
    return this.#html ?? escapeText(this.#text);
  }
  set innerHTML(v: unknown) {
    this.#html = String(v);
    this.#text = '';
    this.children.length = 0;
  }

  appendChild(child: FakeElement): FakeElement {
    child.remove();
    child.parent = this;
    this.children.push(child);
    return child;
  }
  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      if (typeof node === 'string') {
        const text = new FakeElement('#text');
        text.textContent = node;
        this.appendChild(text);
      } else {
        this.appendChild(node);
      }
    }
  }
  remove(): void {
    if (!this.parent) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** 觸發事件並等所有（可能是 async 的）處理函式完成 */
  async dispatch(type: string): Promise<void> {
    const event = { type, target: this, preventDefault() {} };
    await Promise.all((this.listeners.get(type) ?? []).map((fn) => fn(event)));
  }
  focus(): void {
    this.focused = true;
  }
  reset(): void {
    this.resetCount += 1;
  }
}

/** 一個元素（含子孫）的所有內容：文字、HTML、value、屬性 */
function dump(el: FakeElement): string {
  return [
    el.innerHTML,
    el.value,
    ...el.attributes.values(),
    ...el.children.map(dump),
  ].join('\n');
}

/** root 之下第一個 textContent 含 label 的 button 元素 */
function findButton(root: FakeElement, label: string): FakeElement {
  const walk = (el: FakeElement): FakeElement | undefined =>
    el.tagName === 'button' && el.textContent.includes(label)
      ? el
      : el.children.map(walk).find(Boolean);
  const found = walk(root);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

// ------------------------------------------------------------
// 載入 admin.js
// ------------------------------------------------------------

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  owner_id: string | null;
  owner_email: string | null;
  owner_status: string;
  owner_last_sign_in_at: string | null;
  created_by_email: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  status: string;
  url_count: number;
}

function keyRow(overrides: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: KEY_ID,
    name: '報名系統',
    key_prefix: 'tcurl_sk_Ab12Cd',
    scopes: ['read', 'write'],
    owner_id: '22222222-2222-4222-8222-222222222222',
    owner_email: 'kael1996@tzuchi.org.tw',
    owner_status: 'active',
    owner_last_sign_in_at: '2026-11-01T02:03:00Z',
    created_by_email: 'admin@tzuchi.org.tw',
    created_at: '2026-11-03T01:00:00Z',
    // 執行環境時區的 2027/11/03 中午：admin.js 的 formatDate 以本地時區顯示日期，
    // 寫死 UTC 時間在 UTC+12 以上會顯示成 11/04（編輯對話框的「目前：2027/11/03」斷言與時區無關）
    expires_at: new Date(2027, 10, 3, 12).toISOString(),
    revoked_at: null,
    last_used_at: null,
    status: 'active',
    url_count: 7,
    ...overrides,
  };
}

interface FetchCall {
  method: string;
  path: string;
  body: unknown;
  auth: string | undefined;
}

interface AdminApi {
  adminState: Record<string, any>;
  loadApiKeys(): Promise<void>;
  renderApiKeys(): void;
  submitCreateApiKey(): Promise<void>;
  showNewApiKeyOnce(key: string): void;
  revokeApiKey(id: string): Promise<void>;
  editApiKey(id: string): void;
  submitEditApiKey(): Promise<void>;
}

function loadAdmin(initialKeys: ApiKeyRow[] = [keyRow()]) {
  const elements = new Map<string, FakeElement>();
  const body = new FakeElement('body');
  const document = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, new FakeElement(`#${id}`));
      return elements.get(id)!;
    },
    querySelectorAll: () => [],
  };
  const byId = (id: string) => document.getElementById(id);

  const server = {
    keys: [...initialKeys],
    /** 下一個寫入請求（POST/PUT）的錯誤回應 */
    fail: null as { status: number; body: unknown } | null,
  };
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const method = init.method ?? 'GET';
    const { pathname } = new URL(path, 'https://tcurl.test');
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    calls.push({ method, path: pathname, body, auth: init.headers?.Authorization });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

    if (method !== 'GET' && server.fail) {
      const { status, body: errorBody } = server.fail;
      server.fail = null;
      return json(errorBody, status);
    }
    if (method === 'GET' && pathname === '/api/admin/api-keys') return json(server.keys);
    if (method === 'POST' && pathname === '/api/admin/api-keys') {
      const row = keyRow({ id: NEW_KEY_ID, name: body.name, key_prefix: FULL_KEY.slice(0, 15) });
      server.keys.unshift(row);
      return json({ ...row, key: FULL_KEY }, 201);
    }
    const revoke = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)\/revoke$/);
    if (method === 'POST' && revoke) {
      const row = server.keys.find((k) => k.id === decodeURIComponent(revoke[1]))!;
      Object.assign(row, { status: 'revoked', revoked_at: '2026-11-03T05:00:00Z' });
      return json(row);
    }
    const update = pathname.match(/^\/api\/admin\/api-keys\/([^/]+)$/);
    if (method === 'PUT' && update) {
      const row = server.keys.find((k) => k.id === decodeURIComponent(update[1]))!;
      return json(row);
    }
    return json({ error: 'Not found' }, 404);
  });

  const console = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const utils = {
    showNotification: vi.fn(),
    copyToClipboard: vi.fn(async () => true),
    isHttpUrl: () => false,
  };
  const confirm = vi.fn(() => true);
  const auth = { getAccessToken: async () => 'admin-jwt' };
  const window: Record<string, unknown> = {};

  const api = new Function(
    'window',
    'document',
    'auth',
    'utils',
    'fetch',
    'confirm',
    'console',
    `${read('js/admin.js')}
return { adminState, loadApiKeys, renderApiKeys, submitCreateApiKey, showNewApiKeyOnce,
  revokeApiKey, editApiKey, submitEditApiKey }`,
  )(window, document, auth, utils, fetch, confirm, console) as AdminApi;

  /** 所有 console 輸出（序列化後） */
  const consoleText = () =>
    Object.values(console)
      .flatMap((spy) => spy.mock.calls)
      .map((args) => JSON.stringify(args, (_k, v) => (v instanceof Error ? `${v.message}\n${v.stack}` : v)))
      .join('\n');

  /** 頁面上所有內容（body 與所有以 id 取得的元素） */
  const pageText = () => [dump(body), ...[...elements.values()].map(dump)].join('\n');

  return { api, byId, body, server, calls, fetch, console, consoleText, utils, confirm, window, pageText };
}

function fillCreateForm(
  page: ReturnType<typeof loadAdmin>,
  { name = '報名系統', owner = 'kael1996@tzuchi.org.tw', read = true, write = true, expiry = '365' } = {},
) {
  page.byId('apiKeyName').value = name;
  page.byId('apiKeyOwnerEmail').value = owner;
  page.byId('apiKeyScopeRead').checked = read;
  page.byId('apiKeyScopeWrite').checked = write;
  page.byId('apiKeyExpiry').value = expiry;
}

const writes = (page: ReturnType<typeof loadAdmin>) => page.calls.filter((c) => c.method !== 'GET');

// ------------------------------------------------------------
// 靜態檢查
// ------------------------------------------------------------

describe('admin.html 與 admin.js', () => {
  test('admin.html 有「API 金鑰」分頁按鈕與內容區（比照既有分頁）', () => {
    const html = read('admin.html');
    expect(html).toMatch(/<button class="tab-btn [^"]*" data-tab="api-keys">/);
    expect(html).toMatch(/<div id="tab-api-keys" class="tab-content hidden[^"]*">/);
  });

  test('admin.js 以 getElementById 取用的 id 都存在於 admin.html', () => {
    const html = read('admin.html');
    const ids = [...read('js/admin.js').matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    expect(ids).toContain('apiKeysTableBody');
    for (const id of new Set(ids)) expect(html, id).toContain(`id="${id}"`);
  });

  test('admin.js 不使用瀏覽器儲存（localStorage、sessionStorage、indexedDB）', () => {
    expect(read('js/admin.js')).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

// ------------------------------------------------------------
// 列表
// ------------------------------------------------------------

describe('金鑰列表', () => {
  test('loadApiKeys 以管理者 token 取 GET /api/admin/api-keys，顯示 spec §6.6 的欄位', async () => {
    const page = loadAdmin([
      keyRow({ last_used_at: '2026-11-02T03:04:00Z' }),
      keyRow({
        id: '44444444-4444-4444-8444-444444444444',
        name: '舊系統',
        scopes: ['read'],
        owner_email: null,
        owner_status: 'deleted',
        owner_last_sign_in_at: null,
        expires_at: null,
        status: 'revoked',
        url_count: 0,
      }),
    ]);

    await page.api.loadApiKeys();

    expect(page.calls).toEqual([
      { method: 'GET', path: '/api/admin/api-keys', body: undefined, auth: 'Bearer admin-jwt' },
    ]);
    expect(page.api.adminState.loaded['api-keys']).toBe(true);
    expect(page.byId('apiKeyTotal').textContent).toBe('共 2 把');

    const html = page.byId('apiKeysTableBody').innerHTML;
    for (const text of [
      '報名系統',
      'tcurl_sk_Ab12Cd…',
      'kael1996@tzuchi.org.tw',
      '正常',
      '最後登入',
      '讀取',
      '寫入',
      'admin@tzuchi.org.tw',
      '有效',
      '從未使用',
      // 第二把：負責同仁已刪除、不過期、已撤銷
      '舊系統',
      '已刪除',
      '不過期',
      '已撤銷',
    ]) {
      expect(html, text).toContain(text);
    }
    // 每把都能編輯；已撤銷的沒有撤銷按鈕
    expect(html.match(/data-action="edit"/g)).toHaveLength(2);
    expect(html.match(/data-action="revoke"/g)).toHaveLength(1);
    expect(html).toContain(`data-action="revoke" data-id="${KEY_ID}"`);
  });

  test('伺服器回傳的字串都經過 escapeHtml', async () => {
    const page = loadAdmin([
      keyRow({
        id: XSS,
        name: XSS,
        key_prefix: XSS,
        scopes: [XSS],
        owner_email: XSS,
        owner_status: XSS,
        created_by_email: XSS,
        status: XSS,
        created_at: XSS,
        expires_at: XSS,
        last_used_at: XSS,
        owner_last_sign_in_at: XSS,
      }),
    ]);

    await page.api.loadApiKeys();

    const html = page.byId('apiKeysTableBody').innerHTML;
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img');
  });

  test('載入失敗 → 表格顯示載入失敗', async () => {
    const page = loadAdmin();
    page.fetch.mockResolvedValueOnce(new Response('{}', { status: 500 }));

    await page.api.loadApiKeys();

    expect(page.byId('apiKeysTableBody').innerHTML).toContain('載入失敗');
    expect(page.api.adminState.loaded['api-keys']).toBe(false);
  });
});

// ------------------------------------------------------------
// 發放
// ------------------------------------------------------------

describe('發放金鑰', () => {
  test('預設：兩種權限、1 年 → POST /api/admin/api-keys，成功後重設表單並重新載入列表', async () => {
    const page = loadAdmin();
    fillCreateForm(page, { name: '  報名系統  ', owner: ' Kael1996@Tzuchi.org.tw ' });

    await page.api.submitCreateApiKey();

    expect(writes(page)).toEqual([
      {
        method: 'POST',
        path: '/api/admin/api-keys',
        body: {
          name: '報名系統',
          owner_email: 'Kael1996@Tzuchi.org.tw',
          scopes: ['read', 'write'],
          expires_in_days: 365,
        },
        auth: 'Bearer admin-jwt',
      },
    ]);
    expect(page.byId('apiKeyCreateForm').resetCount).toBe(1);
    expect(page.calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/admin/api-keys' });
    expect(page.byId('apiKeysTableBody').innerHTML).toContain(`data-id="${NEW_KEY_ID}"`);
    expect(page.byId('apiKeyCreateBtn').disabled).toBe(false);
  });

  test.each([
    [{ read: true, write: false, expiry: '90' }, ['read'], 90],
    [{ read: false, write: true, expiry: 'never' }, ['write'], null],
  ])('權限與到期日：%j', async (form, scopes, days) => {
    const page = loadAdmin();
    fillCreateForm(page, form);

    await page.api.submitCreateApiKey();

    expect(writes(page)[0].body).toMatchObject({ scopes, expires_in_days: days });
  });

  test.each([
    [{ name: '   ' }, '請輸入服務名稱'],
    [{ owner: ' ' }, '請輸入負責同仁的 email'],
    [{ read: false, write: false }, '權限至少選一項'],
  ])('表單不完整 %j → 不送出，提示「%s」', async (form, message) => {
    const page = loadAdmin();
    fillCreateForm(page, form);

    await page.api.submitCreateApiKey();

    expect(page.calls).toEqual([]);
    expect(page.utils.showNotification).toHaveBeenCalledWith(message, 'error');
  });

  test('完整金鑰只出現在對話框：可複製；不進 adminState、console；關閉後從 DOM 移除', async () => {
    const page = loadAdmin();
    fillCreateForm(page);

    await page.api.submitCreateApiKey();

    // 對話框：完整金鑰 + 提醒
    const dialog = page.body.children.at(-1)!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain(FULL_KEY);
    expect(dialog.textContent).toContain('關閉後就無法再看到，請立即交給對方');

    await findButton(dialog, '複製').dispatch('click');
    expect(page.utils.copyToClipboard).toHaveBeenCalledWith(FULL_KEY);
    expect(page.utils.showNotification).toHaveBeenLastCalledWith('已複製金鑰', 'success');

    // 金鑰不在 adminState、console、列表
    expect(JSON.stringify(page.api.adminState)).not.toContain(FULL_KEY);
    expect(JSON.stringify(page.window)).not.toContain(FULL_KEY);
    expect(page.consoleText()).not.toContain(FULL_KEY);
    expect(page.byId('apiKeysTableBody').innerHTML).not.toContain(FULL_KEY);

    await findButton(dialog, '關閉').dispatch('click');
    expect(page.body.children).not.toContain(dialog);
    expect(page.pageText()).not.toContain(FULL_KEY);
  });

  test('複製失敗 → 提示手動複製，對話框仍在', async () => {
    const page = loadAdmin();
    page.utils.copyToClipboard.mockResolvedValueOnce(false);
    page.api.showNewApiKeyOnce(FULL_KEY);
    const dialog = page.body.children.at(-1)!;

    await findButton(dialog, '複製').dispatch('click');

    expect(page.utils.showNotification).toHaveBeenLastCalledWith(
      '複製失敗，請手動選取金鑰複製',
      'error',
    );
    expect(page.body.children).toContain(dialog);
  });

  test('負責同仁找不到（400）→ 顯示伺服器訊息，不開對話框、不重設表單', async () => {
    const page = loadAdmin();
    page.server.fail = { status: 400, body: { error: '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）' } };
    fillCreateForm(page);

    await page.api.submitCreateApiKey();

    expect(page.utils.showNotification).toHaveBeenCalledWith(
      '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）',
      'error',
    );
    expect(page.body.children).toEqual([]);
    expect(page.byId('apiKeyCreateForm').resetCount).toBe(0);
    expect(page.byId('apiKeyCreateBtn').disabled).toBe(false);
  });

  test('伺服器錯誤（500）→ 顯示一般錯誤訊息，不顯示伺服器原文', async () => {
    const page = loadAdmin();
    page.server.fail = { status: 500, body: { error: 'Failed to create API key' } };
    fillCreateForm(page);

    await page.api.submitCreateApiKey();

    expect(page.utils.showNotification).toHaveBeenCalledWith('發放失敗，請稍後再試', 'error');
  });
});

// ------------------------------------------------------------
// 撤銷
// ------------------------------------------------------------

describe('撤銷金鑰', () => {
  test('二次確認取消 → 不送出', async () => {
    const page = loadAdmin();
    await page.api.loadApiKeys();
    page.confirm.mockReturnValueOnce(false);

    await page.api.revokeApiKey(KEY_ID);

    expect(page.confirm).toHaveBeenCalledWith(expect.stringContaining('報名系統'));
    expect(writes(page)).toEqual([]);
  });

  test('確認 → POST /api/admin/api-keys/:id/revoke，重新載入列表', async () => {
    const page = loadAdmin();
    await page.api.loadApiKeys();

    await page.api.revokeApiKey(KEY_ID);

    expect(writes(page)).toEqual([
      {
        method: 'POST',
        path: `/api/admin/api-keys/${KEY_ID}/revoke`,
        body: {},
        auth: 'Bearer admin-jwt',
      },
    ]);
    expect(page.utils.showNotification).toHaveBeenCalledWith('金鑰已撤銷', 'success');
    expect(page.calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/admin/api-keys' });
    expect(page.byId('apiKeysTableBody').innerHTML).toContain('已撤銷');
  });
});

// ------------------------------------------------------------
// 編輯（名稱、到期、轉移負責同仁）
// ------------------------------------------------------------

describe('編輯金鑰', () => {
  async function openEdit() {
    const page = loadAdmin();
    await page.api.loadApiKeys();
    page.api.editApiKey(KEY_ID);
    return page;
  }

  test('editApiKey 帶入目前的值並開啟對話框；沒有變更 → 不送出、關閉對話框', async () => {
    const page = await openEdit();

    expect(page.byId('apiKeyEditModal').classList.contains('hidden')).toBe(false);
    expect(page.byId('apiKeyEditName').value).toBe('報名系統');
    expect(page.byId('apiKeyEditOwnerEmail').value).toBe('kael1996@tzuchi.org.tw');
    expect(page.byId('apiKeyEditExpiry').value).toBe('keep');
    expect(page.byId('apiKeyEditExpiryKeep').textContent).toContain('2027/11/03');

    await page.api.submitEditApiKey();

    expect(writes(page)).toEqual([]);
    expect(page.byId('apiKeyEditModal').classList.contains('hidden')).toBe(true);
  });

  test('改名稱與到期日 → PUT 只送有變更的欄位（大小寫不同的同一個 email 不算轉移）', async () => {
    const page = await openEdit();
    page.byId('apiKeyEditName').value = ' 新名稱 ';
    page.byId('apiKeyEditExpiry').value = 'never';
    page.byId('apiKeyEditOwnerEmail').value = ' KAEL1996@tzuchi.org.tw ';

    await page.api.submitEditApiKey();

    expect(page.confirm).not.toHaveBeenCalled();
    expect(writes(page)).toEqual([
      {
        method: 'PUT',
        path: `/api/admin/api-keys/${KEY_ID}`,
        body: { name: '新名稱', expires_in_days: null },
        auth: 'Bearer admin-jwt',
      },
    ]);
    expect(page.utils.showNotification).toHaveBeenCalledWith('金鑰已更新', 'success');
    expect(page.byId('apiKeyEditModal').classList.contains('hidden')).toBe(true);
    expect(page.calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/admin/api-keys' });
  });

  test('轉移負責同仁：取消確認 → 不送出，對話框保持開啟', async () => {
    const page = await openEdit();
    page.byId('apiKeyEditOwnerEmail').value = 'new.owner@tzuchi.org.tw';
    page.confirm.mockReturnValueOnce(false);

    await page.api.submitEditApiKey();

    expect(page.confirm).toHaveBeenCalledWith(expect.stringContaining('new.owner@tzuchi.org.tw'));
    expect(writes(page)).toEqual([]);
    expect(page.byId('apiKeyEditModal').classList.contains('hidden')).toBe(false);
  });

  test('轉移負責同仁：確認 → PUT 只送 owner_email；找不到同仁（400）顯示伺服器訊息', async () => {
    const page = await openEdit();
    page.byId('apiKeyEditOwnerEmail').value = ' new.owner@tzuchi.org.tw ';
    page.server.fail = { status: 400, body: { error: '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）' } };

    await page.api.submitEditApiKey();

    expect(writes(page)).toEqual([
      {
        method: 'PUT',
        path: `/api/admin/api-keys/${KEY_ID}`,
        body: { owner_email: 'new.owner@tzuchi.org.tw' },
        auth: 'Bearer admin-jwt',
      },
    ]);
    expect(page.utils.showNotification).toHaveBeenCalledWith(
      '找不到這位同仁（需先登入過 TCurl，且帳號未被停權）',
      'error',
    );
    expect(page.byId('apiKeyEditModal').classList.contains('hidden')).toBe(false);

    await page.api.submitEditApiKey();
    expect(page.utils.showNotification).toHaveBeenLastCalledWith('金鑰已轉移', 'success');
  });

  test('負責同仁已刪除（無 email）：留空只改名稱，不算轉移', async () => {
    const page = loadAdmin([keyRow({ owner_email: null, owner_status: 'deleted' })]);
    await page.api.loadApiKeys();
    page.api.editApiKey(KEY_ID);
    expect(page.byId('apiKeyEditOwnerEmail').value).toBe('');
    page.byId('apiKeyEditName').value = '改名';

    await page.api.submitEditApiKey();

    expect(writes(page)[0].body).toEqual({ name: '改名' });
  });
});
