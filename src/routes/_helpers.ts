/**
 * 路由共用輔助函數
 *
 * @module routes/_helpers
 */

import type { Context } from 'hono';
import { createUserClient, extractToken } from '../services/supabase.ts';
import type { AppEnv } from '../types/env.ts';

/**
 * 從請求中取得使用者 Supabase Client
 */
export function getUserClientFromRequest(
  c: Context<AppEnv>
): ReturnType<typeof createUserClient> | null {
  const token = extractToken(c.req.header('Authorization'));
  if (!token) {
    return null;
  }
  return createUserClient(c.env, token);
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

/**
 * 背景執行工作（不阻塞回應）
 *
 * Workers 回應送出後會停止執行未完成的 Promise，必須交給 executionCtx.waitUntil。
 * 沒有 ExecutionContext（例如單元測試直接呼叫 app.request）時，讓 Promise 自行完成。
 */
export function runInBackground(c: Context, task: PromiseLike<unknown>): void {
  const guarded = Promise.resolve(task).catch((err) => {
    console.error('[Background] task failed:', err instanceof Error ? err.message : err);
  });
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {
    // 無 ExecutionContext
  }
}
