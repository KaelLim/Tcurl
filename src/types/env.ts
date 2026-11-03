/**
 * Cloudflare Workers bindings（對應 cloudflare.config.ts 的 worker.env）
 *
 * 所有設定一律從請求的 `c.env` 讀取，不使用模組層級的全域環境變數。
 *
 * @module types/env
 */

import type { ApiKeyPrincipal } from '../services/api-keys.ts';

export interface Bindings {
  /** Workers Static Assets（目錄 public/） */
  ASSETS: Fetcher;
  /** 密語房間資料（Workers KV） */
  ROOMS_KV: KVNamespace;
  /** 轉址快取（Workers KV；/s/:code 的網址與管道，最多 60 秒，見 services/redirect-cache.ts） */
  REDIRECT_CACHE: KVNamespace;
  /** 一般請求限流（/api/*、HTML 頁面；以 CF-Connecting-IP 為鍵） */
  RATE_LIMITER: RateLimit;
  /** 短網址轉址限流（/s/*、/ad/*；以 CF-Connecting-IP 為鍵，上限比一般限流高） */
  REDIRECT_RATE_LIMITER: RateLimit;
  /** 密碼驗證專屬限流（IP + 短碼） */
  PASSWORD_RATE_LIMITER: RateLimit;
  /** 服務 API 金鑰限流（以 keyId 為鍵；有效金鑰的請求不吃 RATE_LIMITER，見 middleware/api-key-auth.ts） */
  API_KEY_RATE_LIMITER: RateLimit;
  /**
   * 金鑰驗證的每 IP 前置限流（以 CF-Connecting-IP 為鍵）：帶 tcurl_sk_ 的請求在查資料庫驗證之前先扣，
   * 限制單一 IP 每分鐘最多觸發幾次 verify_api_key（見 middleware/api-key-auth.ts）
   */
  API_KEY_VERIFY_RATE_LIMITER: RateLimit;

  SUPABASE_URL: string;
  /** Supabase publishable / anon key（公開值） */
  SUPABASE_ANON_KEY: string;
  /** Secret：繞過 RLS 的 service role key */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Secret：管理員 email（逗號分隔） */
  ADMIN_EMAILS?: string;

  BASE_URL?: string;
  CORS_ORIGIN?: string;

  /** 選用：短代碼長度（預設 6） */
  SHORT_CODE_LENGTH?: string;
  /** 選用：設為 'false' 可停用限流 */
  RATE_LIMIT_ENABLED?: string;
  /** 選用：設為 'development' 時允許 localhost CORS 來源 */
  ENVIRONMENT?: string;
}

/**
 * Hono 泛型參數
 *
 * - `apiKey`：通過驗證的服務 API 金鑰（由 middleware/api-key-auth.ts 設定；一般使用者請求為 undefined）
 */
export type AppEnv = { Bindings: Bindings; Variables: { apiKey?: ApiKeyPrincipal } };
