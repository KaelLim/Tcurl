/**
 * 服務 API 金鑰模組（src/services/api-keys.ts）
 *
 * - 金鑰格式：tcurl_sk_ + 32 bytes 亂數的 base64url（無 =）；顯示用前綴 = 前 15 字元
 * - 資料庫只存 SHA-256 hex；verify_api_key RPC 只收雜湊，不收原始金鑰
 * - Authorization 解析：scheme 不分大小寫、token 去除前後空白（從後台複製時常夾帶換行）
 */

import { afterEach, expect, test, vi } from 'vitest';
import {
  API_KEY_PREFIX,
  generateApiKey,
  hashApiKey,
  isApiKeyToken,
  parseBearer,
  verifyApiKey,
} from '../src/services/api-keys.ts';
import { createTestEnv, jsonResponse, mockSupabaseFetch } from './helpers/test-env.ts';

const RPC_PATH = '/rest/v1/rpc/verify_api_key';
const KEY = 'tcurl_sk_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ============================================================
// 產生與雜湊
// ============================================================

test('generateApiKey：tcurl_sk_ + 43 字元 base64url，前綴為前 15 字元，hash 為金鑰的 SHA-256', async () => {
  const { key, prefix, hash } = await generateApiKey();
  expect(API_KEY_PREFIX).toBe('tcurl_sk_');
  expect(key).toMatch(/^tcurl_sk_[A-Za-z0-9_-]{43}$/);
  expect(prefix).toBe(key.slice(0, 15));
  expect(hash).toBe(await hashApiKey(key));
});

test('generateApiKey：每次產生的金鑰都不同', async () => {
  const a = await generateApiKey();
  const b = await generateApiKey();
  expect(a.key).not.toBe(b.key);
  expect(a.hash).not.toBe(b.hash);
});

test('hashApiKey：SHA-256 hex（與 node crypto 計算結果相同）', async () => {
  expect(await hashApiKey('tcurl_sk_test')).toBe(
    '88ce19354cfce0147b8e9d78e2cd6f09a96bba88e729ae3efd49d943684eeae6',
  );
});

// ============================================================
// Authorization 解析
// ============================================================

test('parseBearer：去除 token 前後空白與換行', () => {
  expect(parseBearer('Bearer  tcurl_sk_abc \n')).toBe('tcurl_sk_abc');
});

test('parseBearer：scheme 不分大小寫', () => {
  expect(parseBearer('bearer x')).toBe('x');
  expect(parseBearer('BEARER x')).toBe('x');
});

test('parseBearer：沒有 Bearer scheme 或沒有 token 時回 null', () => {
  expect(parseBearer('tcurl_sk_abc')).toBeNull();
  expect(parseBearer('Basic dXNlcjpwYXNz')).toBeNull();
  expect(parseBearer('Bearer')).toBeNull();
  expect(parseBearer('Bearer   ')).toBeNull();
  expect(parseBearer('')).toBeNull();
  expect(parseBearer(undefined)).toBeNull();
});

test('isApiKeyToken：只有 tcurl_sk_ 開頭的才是金鑰（Supabase JWT 不是）', () => {
  expect(isApiKeyToken('tcurl_sk_abc')).toBe(true);
  expect(isApiKeyToken('eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig')).toBe(false);
  expect(isApiKeyToken('TCURL_SK_abc')).toBe(false);
});

// ============================================================
// verifyApiKey（verify_api_key RPC）
// ============================================================

test('verifyApiKey：RPC 回 ok → principal；以 service role 呼叫，body 只帶雜湊不帶原始金鑰', async () => {
  const { calls } = mockSupabaseFetch((call) => {
    if (call.method === 'POST' && call.url.pathname === RPC_PATH) {
      return jsonResponse({
        status: 'ok',
        key_id: 'k1',
        name: 'svc',
        owner_id: 'u1',
        scopes: ['read'],
      });
    }
    return undefined;
  });

  const result = await verifyApiKey(createTestEnv(), KEY);

  expect(result).toEqual({
    ok: true,
    principal: { keyId: 'k1', name: 'svc', ownerId: 'u1', scopes: ['read'] },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('POST');
  expect(calls[0].url.pathname).toBe(RPC_PATH);
  expect(calls[0].headers.get('apikey')).toBe('test-service-role-key');
  expect(JSON.parse(calls[0].body!)).toEqual({ p_key_hash: await hashApiKey(KEY) });
  expect(calls[0].body).not.toContain(KEY);
});

test.each(['not_found', 'revoked', 'expired', 'owner_missing', 'owner_banned'] as const)(
  'verifyApiKey：RPC 回 %s → ok: false 並帶相同原因',
  async (status) => {
    mockSupabaseFetch((call) =>
      call.url.pathname === RPC_PATH ? jsonResponse({ status }) : undefined,
    );
    expect(await verifyApiKey(createTestEnv(), KEY)).toEqual({ ok: false, reason: status });
  },
);

test('verifyApiKey：RPC 回 500 → reason error，記錄不含原始金鑰', async () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  mockSupabaseFetch((call) =>
    call.url.pathname === RPC_PATH
      ? jsonResponse({ code: 'XX000', message: 'internal error' }, 500)
      : undefined,
  );

  expect(await verifyApiKey(createTestEnv(), KEY)).toEqual({ ok: false, reason: 'error' });
  expect(errorSpy).toHaveBeenCalled();
  expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(KEY);
});

test('verifyApiKey：連線失敗 → reason error（不丟例外）', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('network down');
    }),
  );

  expect(await verifyApiKey(createTestEnv(), KEY)).toEqual({ ok: false, reason: 'error' });
});

test('verifyApiKey：RPC 回傳無法辨識的內容 → reason error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockSupabaseFetch((call) =>
    call.url.pathname === RPC_PATH ? jsonResponse({ status: 'something_else' }) : undefined,
  );

  expect(await verifyApiKey(createTestEnv(), KEY)).toEqual({ ok: false, reason: 'error' });
});

// 格式預檢（spec §6.5「避免灌爆資料庫查詢」）：不是發放格式的 token 不可能存在於資料庫，不查 DB
test.each([
  ['太短', 'tcurl_sk_abc'],
  ['少一個字元', KEY.slice(0, -1)],
  ['多一個字元', `${KEY}A`],
  ['含非 base64url 字元', `${KEY.slice(0, -1)}=`],
  ['含空白', `${KEY.slice(0, 20)} ${KEY.slice(21)}`],
  ['兩把金鑰相連', `${KEY}${KEY}`],
])('verifyApiKey：格式不符（%s）→ reason malformed，不呼叫 RPC', async (_label, token) => {
  const { calls } = mockSupabaseFetch(() => jsonResponse({ status: 'ok' }));

  expect(await verifyApiKey(createTestEnv(), token)).toEqual({ ok: false, reason: 'malformed' });
  expect(calls).toHaveLength(0);
});

test('verifyApiKey：generateApiKey 產生的金鑰都通過格式預檢（會呼叫 RPC）', async () => {
  for (let i = 0; i < 20; i++) {
    const { key } = await generateApiKey();
    const { calls } = mockSupabaseFetch((call) =>
      call.url.pathname === RPC_PATH ? jsonResponse({ status: 'not_found' }) : undefined,
    );
    expect(await verifyApiKey(createTestEnv(), key)).toEqual({ ok: false, reason: 'not_found' });
    expect(calls).toHaveLength(1);
  }
});
