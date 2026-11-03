/**
 * 服務 API 金鑰（spec：docs/superpowers/specs/2026-11-03-api-keys-design.md §6.1、§6.4）
 *
 * - 格式：`tcurl_sk_` + 32 bytes 密碼學亂數的 base64url（無 `=`，43 字元）
 * - 資料庫只存 SHA-256 hex 與顯示用前綴（金鑰前 15 字元）；完整金鑰只在發放當下回傳一次
 * - 驗證：計算雜湊後呼叫 `verify_api_key` RPC（service role），每次都查資料庫、不快取，
 *   撤銷立即生效。格式不符的 token 不可能是發放過的金鑰，直接判為無效、不查資料庫
 *
 * 本模組不記錄完整金鑰；呼叫端記錄驗證失敗時也只能記雜湊開頭幾碼與原因。
 *
 * @module services/api-keys
 */

import { getSupabase } from './supabase.ts';
import type { Bindings } from '../types/env.ts';

/** 金鑰固定開頭（方便辨識、方便搜尋外洩） */
export const API_KEY_PREFIX = 'tcurl_sk_';

/** 顯示用前綴長度（`tcurl_sk_` + 6 字元） */
const DISPLAY_PREFIX_LENGTH = 15;

/** 亂數部分的位元組數 */
const KEY_RANDOM_BYTES = 32;

/** 發放的金鑰格式：前綴 + 32 bytes 的 base64url（無 `=`，43 字元） */
const API_KEY_FORMAT = /^tcurl_sk_[A-Za-z0-9_-]{43}$/;

export type ApiKeyScope = 'read' | 'write';

/** 驗證成功的金鑰呼叫者 */
export interface ApiKeyPrincipal {
  keyId: string;
  name: string;
  ownerId: string;
  scopes: ApiKeyScope[];
}

export type ApiKeyVerifyResult =
  | { ok: true; principal: ApiKeyPrincipal }
  | {
      ok: false;
      reason:
        | 'malformed'
        | 'not_found'
        | 'revoked'
        | 'expired'
        | 'owner_missing'
        | 'owner_banned'
        | 'error';
    };

/** verify_api_key 失敗時可能回的 status（與 RPC 一致） */
const FAILURE_STATUSES = [
  'not_found',
  'revoked',
  'expired',
  'owner_missing',
  'owner_banned',
] as const;
type FailureStatus = (typeof FAILURE_STATUSES)[number];

const SCOPES: readonly ApiKeyScope[] = ['read', 'write'];

/**
 * 從 Authorization 標頭取出 Bearer token。
 * scheme 不分大小寫；token 去除前後空白（從後台複製金鑰時常夾帶空白或換行）。
 * 沒有標頭、沒有 Bearer scheme 或 token 為空時回 null。
 */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^bearer\s+(.*)$/is.exec(header.trim());
  const token = match?.[1].trim();
  return token ? token : null;
}

/** token 是否為服務 API 金鑰（否則視為 Supabase JWT） */
export function isApiKeyToken(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}

/** 金鑰的 SHA-256 雜湊（小寫 hex） */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 產生新金鑰。`key` 只能回傳給發放的管理者一次，資料庫只存 `prefix` 與 `hash`。
 */
export async function generateApiKey(): Promise<{ key: string; prefix: string; hash: string }> {
  const random = crypto.getRandomValues(new Uint8Array(KEY_RANDOM_BYTES));
  const key = API_KEY_PREFIX + toBase64Url(random);
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH), hash: await hashApiKey(key) };
}

/**
 * 驗證金鑰：雜湊後呼叫 verify_api_key RPC（只傳雜湊，不傳原始金鑰）。
 * 格式不符（不是 generateApiKey 產生的形狀）回 `{ ok: false, reason: 'malformed' }`，不查資料庫。
 * RPC 錯誤、連線失敗或回傳無法辨識的內容一律回 `{ ok: false, reason: 'error' }`，不丟例外。
 */
export async function verifyApiKey(env: Bindings, key: string): Promise<ApiKeyVerifyResult> {
  if (!API_KEY_FORMAT.test(key)) return { ok: false, reason: 'malformed' };
  try {
    const hash = await hashApiKey(key);
    const { data, error } = await getSupabase(env).rpc('verify_api_key', { p_key_hash: hash });
    if (error) {
      console.error('[ApiKey] verify_api_key RPC error:', error.code, error.message);
      return { ok: false, reason: 'error' };
    }

    const status = data?.status;
    if (FAILURE_STATUSES.includes(status)) {
      return { ok: false, reason: status as FailureStatus };
    }
    if (
      status === 'ok' &&
      typeof data.key_id === 'string' &&
      typeof data.name === 'string' &&
      typeof data.owner_id === 'string' &&
      Array.isArray(data.scopes)
    ) {
      return {
        ok: true,
        principal: {
          keyId: data.key_id,
          name: data.name,
          ownerId: data.owner_id,
          scopes: SCOPES.filter((s) => data.scopes.includes(s)),
        },
      };
    }

    console.error('[ApiKey] verify_api_key returned unexpected status:', String(status));
    return { ok: false, reason: 'error' };
  } catch (err) {
    console.error('[ApiKey] verify_api_key failed:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'error' };
  }
}
