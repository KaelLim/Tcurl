/**
 * Supabase 客戶端服務 - Deno 版本
 *
 * 提供兩種客戶端模式：
 * 1. Service Client - 繞過 RLS，用於系統級操作
 * 2. User Client - 遵守 RLS，用於使用者級操作
 *
 * @module services/supabase
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Supabase 連線設定
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

// 全域 Supabase 客戶端實例
let _supabase: SupabaseClient | null = null;

/**
 * 初始化 Supabase 連線
 * @throws 如果缺少必要的環境變數
 */
export function initSupabase(): void {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'
    );
  }

  _supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  console.log('✅ Supabase connected successfully');
}

/**
 * Service Role Client - 繞過 RLS
 *
 * 用於：
 * - 短網址重定向（公開訪問）
 * - 記錄點擊統計
 * - 系統級操作
 */
export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    throw new Error('Supabase not initialized. Call initSupabase() first.');
  }
  return _supabase;
}

/**
 * 建立使用者專屬的 Supabase Client
 * 使用使用者的 JWT Token，RLS 會自動生效
 *
 * @param accessToken - 使用者的 JWT Token（從 Authorization header 取得）
 * @returns Supabase Client with user context
 */
export function createUserClient(accessToken: string): SupabaseClient {
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

/**
 * 驗證 Token 並取得使用者資訊
 *
 * @param accessToken - JWT Token
 * @returns User info or null
 */
export async function verifyAndGetUser(
  accessToken: string
): Promise<{ id: string; email?: string } | null> {
  try {
    const supabase = getSupabase();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(accessToken);

    if (error || !user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
    };
  } catch {
    return null;
  }
}

// 為了向後相容，也導出 supabase 作為 getter
export const supabase = {
  get client(): SupabaseClient {
    return getSupabase();
  },
};
