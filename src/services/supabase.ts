/**
 * Supabase 客戶端服務 - Cloudflare Workers 版本
 *
 * 提供兩種客戶端模式：
 * 1. Service Client - 繞過 RLS，用於系統級操作
 * 2. User Client - 遵守 RLS，用於使用者級操作
 *
 * Workers 沒有行程層級的環境變數；連線設定一律由呼叫端傳入請求的 env（c.env）。
 *
 * @module services/supabase
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

import type { Bindings } from '../types/env.ts';

/** 建立 client 所需的 env 欄位 */
export type SupabaseEnv = Pick<
  Bindings,
  'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'
>;

/**
 * Service Role Client - 繞過 RLS
 *
 * 用於：
 * - 短網址重定向（公開訪問）
 * - 記錄點擊統計
 * - 系統級操作
 *
 * @throws 如果缺少必要的環境變數
 */
export function getSupabase(env: SupabaseEnv): SupabaseClient {
  return createServiceClient(env);
}

/**
 * 服務 API 金鑰請求專用的 Service Role Client（繞過 RLS）
 *
 * 每個請求都帶 `x-tcurl-api-key-id` 標頭：資料庫的 url_audit_trigger 只在呼叫者是 service role 時
 * 採信這個標頭，把金鑰 id 記到 audit_logs.api_key_id（spec §6.8）。
 * 繞過 RLS，所以對 urls 的查詢與修改一律要經 routes/_helpers.ts 的 `scopeToApiKey` 限定範圍。
 */
export function getSupabaseForApiKey(env: SupabaseEnv, keyId: string): SupabaseClient {
  return createServiceClient(env, { 'x-tcurl-api-key-id': keyId });
}

function createServiceClient(
  env: SupabaseEnv,
  headers: Record<string, string> = {}
): SupabaseClient {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    global: { headers },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 建立使用者專屬的 Supabase Client
 * 使用使用者的 JWT Token，RLS 會自動生效
 *
 * @param env - 請求的 env（c.env）
 * @param accessToken - 使用者的 JWT Token（從 Authorization header 取得）
 * @returns Supabase Client with user context
 */
export function createUserClient(env: SupabaseEnv, accessToken: string): SupabaseClient {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_ANON_KEY are required'
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/**
 * 判斷字串「含服務 API 金鑰」（services/api-keys.ts 的 API_KEY_PREFIX `tcurl_sk_`）：不分大小寫，
 * 兩個底線任一個（或兩個）被 URL 編碼成 `%5F` 也認得，前綴被改寫過的金鑰也不會被當成 JWT 送出。
 * middleware/api-key-auth.ts 判斷金鑰請求也用這一個（兩處一致）。放在這裡而不放 api-keys.ts，
 * 避免 supabase.ts ↔ api-keys.ts 互相 import。
 */
export const API_KEY_MARKER = /tcurl(?:_|%5f)sk(?:_|%5f)/i;

/**
 * 從 Authorization header 提取 JWT Token
 *
 * token 含 `tcurl_sk_`（服務 API 金鑰；判斷方式見 API_KEY_MARKER）時回 null：
 * 金鑰請求只能走 middleware/api-key-auth.ts，路由若漏寫金鑰分支，也不會把完整金鑰當 JWT 送到 Supabase（第二道防線）。
 *
 * @param authHeader - Authorization header value (e.g., "Bearer eyJxxx...")
 * @returns JWT token or null
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix
  return API_KEY_MARKER.test(token) ? null : token;
}
