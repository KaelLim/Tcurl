/**
 * 服務 API 金鑰中介層（spec：docs/superpowers/specs/2026-11-03-api-keys-design.md §6.3–§6.5）
 *
 * 金鑰請求的唯一關卡。只處理 `/api/*` 且 `Authorization` 含 `tcurl_sk_` 的請求（不分大小寫，
 * 底線被 URL 編碼的 `tcurl%5Fsk_`、`tcurl_sk%5F` 也算；判斷同 extractToken，見 services/supabase.ts 的 API_KEY_MARKER）；
 * 其他請求原封不動交給後面（一般 IP 限流、Supabase JWT 流程）。
 * 含 `tcurl_sk_` 但不是 `Bearer tcurl_sk_…`（scheme 不分大小寫）的寫法，例如 `Bearer Bearer tcurl_sk_…`、
 * `Bearer "tcurl_sk_…"`、`Token tcurl_sk_…`、`Bearer TCURL_SK_…`，一律當無效金鑰（reason malformed_header），
 * 不交給 JWT 流程，避免路由把完整金鑰當 JWT 送到 Supabase。
 *
 * 0. 驗證前的每 IP 前置限流（API_KEY_VERIFY_RATE_LIMITER，寬鬆上限）→ 超過回 429，不查資料庫。
 *    Rate Limiting binding 沒有「只看不扣」，無效金鑰的 IP 限流只能在驗證之後才扣；沒有這一道，
 *    同一個 IP 超過 RATE_LIMITER 之後，每個亂造的金鑰仍各觸發一次 verify_api_key（spec §6.5
 *    「避免灌爆資料庫查詢」）。上限遠高於每把金鑰的上限，只擋異常流量，不是一般的 IP 限流
 * 1. 驗證金鑰（格式不符直接判無效；否則每次查資料庫，不快取）
 *    無效 → 先記錄原因與雜湊開頭（不記金鑰原文；429 時也記），再計入 IP 限流（RATE_LIMITER）：
 *    超過回 429，否則 401（訊息不區分原因）
 *    驗證服務本身出錯（reason error）→ 503 + Retry-After：不是金鑰無效，不扣 IP 額度、不記為無效金鑰
 * 2. 有效 → 立即 `c.set('apiKey', principal)`，讓稽核紀錄也記得到被拒請求是哪把金鑰；
 *    路由以 routes/_helpers.ts 的 `getApiKey` 取得呼叫者
 * 3. 每把金鑰各自限流（API_KEY_RATE_LIMITER，鍵為 keyId）→ 超過回 429。
 *    排在白名單與權限檢查之前，被 4、5 拒絕的請求也計入該金鑰的額度（spec §6.5）。
 *    有效金鑰不吃一般 IP 限流（多個內部服務可能共用同一個對外 IP），main.ts 的一般限流看到
 *    `c.get('apiKey')` 就跳過
 * 4. 端點不在白名單（API_KEY_ROUTES）→ 401。新端點預設拒絕金鑰，要開放必須明確加進白名單
 * 5. 權限不足 → 403
 * 6. 通過 3–5 才呼叫 `next()`；被拒的請求直接回應，路由與一般限流都不會執行
 *
 * 必須註冊在 main.ts 的一般限流之前。
 *
 * @module middleware/api-key-auth
 */

import type { Context, MiddlewareHandler } from 'hono';

import {
  API_KEY_PREFIX,
  hashApiKey,
  isApiKeyToken,
  parseBearer,
  verifyApiKey,
  type ApiKeyScope,
} from '../services/api-keys.ts';
import { API_KEY_MARKER } from '../services/supabase.ts';
import type { AppEnv } from '../types/env.ts';

/**
 * 接受金鑰的端點（spec §6.3）與需要的權限。路徑格式同 Hono 路由（`:param` 為單一路徑段）。
 * 不在表內的端點（/api/admin/*、/api/auth/*、/api/feedbacks*…以及日後新增的端點）一律拒絕金鑰。
 * 增減端點時同步更新 public/docs/openapi.yaml（tests/openapi_api_key_test.ts 會比對）。
 * matchApiKeyRoute 只比對路徑形狀：tests/api_key_auth_test.ts 的「白名單守門」要求 app 裡會被放行的
 * 路由都逐字列在這裡（例如新增 GET /api/urls/export 會被當成 GET /api/urls/:id，測試會失敗）。
 */
export const API_KEY_ROUTES: ReadonlyArray<{ method: string; path: string; scope: ApiKeyScope }> = [
  { method: 'GET', path: '/api/urls', scope: 'read' },
  { method: 'GET', path: '/api/urls/stats/summary', scope: 'read' },
  { method: 'GET', path: '/api/stats/daily', scope: 'read' },
  { method: 'GET', path: '/api/urls/:id', scope: 'read' },
  { method: 'GET', path: '/api/urls/:id/stats', scope: 'read' },
  { method: 'GET', path: '/api/urls/:id/channels', scope: 'read' },
  { method: 'POST', path: '/api/urls', scope: 'write' },
  { method: 'PUT', path: '/api/urls/:id', scope: 'write' },
  { method: 'DELETE', path: '/api/urls/:id', scope: 'write' },
  { method: 'PATCH', path: '/api/urls/:id/qr-code', scope: 'write' },
  { method: 'POST', path: '/api/urls/:id/channels', scope: 'write' },
  { method: 'PUT', path: '/api/urls/:id/channels/:channelId', scope: 'write' },
  { method: 'DELETE', path: '/api/urls/:id/channels/:channelId', scope: 'write' },
];

const ROUTE_PATTERNS = API_KEY_ROUTES.map((route) => ({ ...route, segments: route.path.split('/') }));

/** 金鑰無效、已失效，或端點不允許金鑰（spec §6.4：訊息不區分原因） */
const INVALID_KEY_BODY = { error: 'Unauthorized', message: 'API 金鑰無效或已失效' };
const FORBIDDEN_BODY = { error: 'Forbidden', message: '此 API 金鑰沒有此操作的權限' };
/** 驗證服務本身出錯（verify reason 'error'）：不是金鑰無效，請對方稍後重試 */
const UNAVAILABLE_BODY = { error: 'Service Unavailable', message: '暫時無法驗證 API 金鑰，請稍後重試' };
/** 503 的 Retry-After（秒） */
const VERIFY_RETRY_AFTER_SECONDS = 30;

/**
 * 限流時間窗（秒）；上限設定在 cloudflare.config.ts
 * （RATE_LIMITER、API_KEY_RATE_LIMITER、API_KEY_VERIFY_RATE_LIMITER）
 */
const RATE_LIMIT_PERIOD_SECONDS = 60;

/** 驗證失敗時記錄的雜湊開頭長度（可對照 api_keys.key_hash，不記金鑰原文） */
const HASH_PREFIX_LENGTH = 8;

/**
 * 金鑰可以呼叫的端點需要什麼權限；不在白名單回 null。
 * 方法與路徑大小寫須完全相符；路徑參數不可為空（`/api/urls/` 不算 `/api/urls/:id`）。
 */
export function matchApiKeyRoute(method: string, path: string): ApiKeyScope | null {
  const segments = path.split('/');
  for (const route of ROUTE_PATTERNS) {
    if (route.method !== method || route.segments.length !== segments.length) continue;
    const matched = route.segments.every((pattern, i) =>
      pattern.startsWith(':') ? segments[i] !== '' : pattern === segments[i]
    );
    if (matched) return route.scope;
  }
  return null;
}

/**
 * 呼叫限流器，回傳是否放行。與 main.ts 的一般限流一致：RATE_LIMIT_ENABLED=false、
 * 沒有 binding，或限流服務異常（fail-open）時放行。
 */
async function withinRateLimit(
  c: Context<AppEnv>,
  limiter: RateLimit | undefined,
  key: string
): Promise<boolean> {
  if (c.env.RATE_LIMIT_ENABLED === 'false' || !limiter) return true;
  try {
    const { success } = await limiter.limit({ key });
    return success;
  } catch (err) {
    console.error('Rate limiter error:', err instanceof Error ? err.message : err);
    return true;
  }
}

/** 429 JSON（格式與 main.ts 一般限流的 API 回應相同） */
function tooManyRequests(c: Context<AppEnv>): Response {
  return c.json(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `請求過於頻繁，請在 ${RATE_LIMIT_PERIOD_SECONDS} 秒後重試`,
    },
    429
  );
}

/** 記錄被拒的金鑰請求：只記原因與雜湊開頭（可對照 api_keys.key_hash），不記金鑰原文（spec §6.8） */
async function logRejectedKey(token: string, reason: string): Promise<void> {
  const hashPrefix = (await hashApiKey(token)).slice(0, HASH_PREFIX_LENGTH);
  console.warn('[ApiKey] verify failed', { reason, hashPrefix });
}

/**
 * 無效金鑰：先記錄再判斷限流（暴力嘗試被 429 時也要留下失敗原因），
 * 並照樣計入 IP 限流，避免用亂造的金鑰繞過 IP 限流（spec §6.5）
 */
async function rejectInvalidKey(
  c: Context<AppEnv>,
  token: string,
  reason: string,
  ip: string
): Promise<Response> {
  await logRejectedKey(token, reason);
  if (!(await withinRateLimit(c, c.env.RATE_LIMITER, ip))) return tooManyRequests(c);
  return c.json(INVALID_KEY_BODY, 401);
}

/** 標頭內的第一段 `tcurl_sk_…`（格式錯誤的標頭也以它的雜湊記錄，可對照是哪把金鑰設定錯誤） */
function embeddedKey(header: string): string {
  return /tcurl_sk_[A-Za-z0-9_-]*/.exec(header)?.[0] ?? API_KEY_PREFIX;
}

export function apiKeyAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.req.path.startsWith('/api/')) return next();
    const header = c.req.header('Authorization');
    // 標頭含 tcurl_sk_ 就是金鑰請求，一律在這裡處理、不交給 JWT 流程：`Bearer Bearer tcurl_sk_…`、
    // `Bearer "tcurl_sk_…"`、`Token tcurl_sk_…`、`Bearer TCURL_SK_…`、`Bearer tcurl%5Fsk_…` 這類寫法若放行，
    // 路由會把完整金鑰（或它的亂數部分）當 JWT 送到 Supabase
    if (!header || !API_KEY_MARKER.test(header)) return next();
    const bearer = parseBearer(header);
    const token = bearer && isApiKeyToken(bearer) ? bearer : null;

    const ip = c.req.header('cf-connecting-ip') || 'unknown';

    // 驗證要查資料庫：先以 IP 扣寬鬆的前置限流，超過就不查（spec §6.5）
    if (!(await withinRateLimit(c, c.env.API_KEY_VERIFY_RATE_LIMITER, ip))) {
      await logRejectedKey(token ?? embeddedKey(header), 'verify_rate_limited');
      return tooManyRequests(c);
    }

    // 不是 `Bearer tcurl_sk_…`：不查資料庫，當作無效金鑰
    if (!token) return rejectInvalidKey(c, embeddedKey(header), 'malformed_header', ip);

    const result = await verifyApiKey(c.env, token);
    if (!result.ok) {
      // 驗證服務本身出錯（資料庫、網路）不代表金鑰無效：回 503 讓對方稍後重試，而不是誤以為金鑰被撤銷。
      // 不扣 IP 額度、不記為無效金鑰（錯誤已由 services/api-keys.ts 記錄）
      if (result.reason === 'error') {
        return c.json(UNAVAILABLE_BODY, 503, { 'Retry-After': String(VERIFY_RETRY_AFTER_SECONDS) });
      }
      return rejectInvalidKey(c, token, result.reason, ip);
    }

    const key = result.principal;
    // 驗證成功就設定：被拒的請求（429／401／403）在稽核紀錄裡也看得出是哪把金鑰。
    // 只有通過以下所有檢查才會呼叫 next()，路由與一般限流不會看到被拒的請求。
    c.set('apiKey', key);

    // 先限流再檢查白名單與權限：被拒的請求不會走到 main.ts 的一般限流，若排在後面，
    // 拿著有效金鑰打不允許的端點就完全不受限流，每次都查一次驗證 RPC（spec §6.5）
    if (!(await withinRateLimit(c, c.env.API_KEY_RATE_LIMITER, key.keyId))) {
      return tooManyRequests(c);
    }

    const scope = matchApiKeyRoute(c.req.method, c.req.path);
    if (!scope) return c.json(INVALID_KEY_BODY, 401);
    if (!key.scopes.includes(scope)) return c.json(FORBIDDEN_BODY, 403);

    return next();
  };
}
