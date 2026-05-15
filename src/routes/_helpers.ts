/**
 * 路由共用輔助函數
 *
 * @module routes/_helpers
 */

import type { Context } from '@hono/hono';
import { createUserClient, extractToken } from '../services/supabase.ts';

/**
 * 從請求中取得使用者 Supabase Client
 */
export function getUserClientFromRequest(c: Context): ReturnType<typeof createUserClient> | null {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return null;
  }
  return createUserClient(token);
}

/**
 * 回傳未授權錯誤
 */
export function sendUnauthorized(c: Context): Response {
  return c.json(
    {
      error: 'Unauthorized',
      message: '請先登入',
    },
    401
  );
}
