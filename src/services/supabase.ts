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
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
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
 * 從 Authorization header 提取 JWT Token
 *
 * @param authHeader - Authorization header value (e.g., "Bearer eyJxxx...")
 * @returns JWT token or null
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove 'Bearer ' prefix
}
