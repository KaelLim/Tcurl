import { createClient, SupabaseClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

/**
 * Service Role Client - 繞過 RLS，用於：
 * - 短網址重定向（公開訪問）
 * - 記錄點擊統計
 * - 系統級操作
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

/**
 * 建立使用者專屬的 Supabase Client
 * 使用使用者的 JWT Token，RLS 會自動生效
 *
 * @param accessToken - 使用者的 JWT Token（從 Authorization header 取得）
 * @returns Supabase Client with user context
 */
export function createUserClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })
}

/**
 * 從 Authorization header 提取 JWT Token
 *
 * @param authHeader - Authorization header value (e.g., "Bearer eyJxxx...")
 * @returns JWT token or null
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7) // Remove 'Bearer ' prefix
}

/**
 * 驗證 Token 並取得使用者資訊
 *
 * @param accessToken - JWT Token
 * @returns User info or null
 */
export async function verifyAndGetUser(accessToken: string) {
  try {
    const { data: { user }, error } = await supabase.auth.getUser(accessToken)
    if (error || !user) {
      return null
    }
    return user
  } catch {
    return null
  }
}
