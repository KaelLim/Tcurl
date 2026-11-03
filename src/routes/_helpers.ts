/**
 * 路由共用輔助函數
 *
 * @module routes/_helpers
 */

import type { Context } from 'hono';
import type { ApiKeyPrincipal } from '../services/api-keys.ts';
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
 * 通過驗證的服務 API 金鑰（middleware/api-key-auth.ts 設定）；一般使用者請求為 undefined。
 * 有金鑰時路由改用 `getSupabaseForApiKey`，對 urls 的存取一律經 `scopeToApiKey`。
 */
export function getApiKey(c: Context<AppEnv>): ApiKeyPrincipal | undefined {
  return c.get('apiKey');
}

/**
 * 把對 urls 的查詢／修改限定在這把金鑰建立的短網址：同時限定
 * `created_by = 負責同仁` 且 `api_key_id = 這把金鑰`（spec §6.4；就算 api_key_id 被錯設，
 * 負責人不同金鑰也碰不到）。回傳同一個 query builder，可以繼續串接。
 */
export function scopeToApiKey<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  key: ApiKeyPrincipal
): Q {
  return query.eq('created_by', key.ownerId).eq('api_key_id', key.keyId);
}

/**
 * 依呼叫者限定對 urls 的查詢／修改：金鑰請求 → `scopeToApiKey`；使用者請求原樣（RLS 負責）。
 * client 必須跟著同一個 key 選：有 key 用 `getSupabaseForApiKey`，沒有用 user client。
 */
export function scopeToCaller<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  key: ApiKeyPrincipal | undefined
): Q {
  return key ? scopeToApiKey(query, key) : query;
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
