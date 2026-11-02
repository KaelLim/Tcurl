/**
 * Cloudflare 專案設定（cf CLI / @cloudflare/vite-plugin 讀取）
 *
 * - Worker 名稱 tcurl → https://tcurl.tzuchidigital.workers.dev
 * - 靜態檔：Vite 的 public/ 目錄（publicDir）原樣成為 Workers Static Assets
 * - Secrets 只宣告名稱，值在部署時注入（cf deploy --secrets-file 或 npx wrangler secret put），不可寫進 repo
 */

import { bindings, defineConfig } from 'cf/config';
import * as entrypoint from './src/main.ts' with { type: 'cf-worker' };

/**
 * ROOMS_KV 的 namespace id（tzuchidigital 帳號上的 KV namespace）。
 * 本機 `cf dev` 使用本機模擬的 KV，不會讀寫這個 namespace。
 */
const ROOMS_KV_NAMESPACE_ID = 'd6b78a14f52c4738a9d992aac56a7354';

/**
 * REDIRECT_CACHE 的 namespace id（tcurl-redirect-cache）：/s/:code 的轉址快取，最多 60 秒。
 * 見 src/services/redirect-cache.ts。
 */
const REDIRECT_CACHE_NAMESPACE_ID = '04f53a61677445138a45239c92c7f25a';

export default defineConfig({
  worker: {
    name: 'tcurl',
    compatibilityDate: '2026-10-15',
    // bcryptjs 會 import Node 的 crypto 模組（Workers 以 nodejs_compat 提供）
    compatibilityFlags: ['nodejs_compat'],
    entrypoint,
    assets: {
      // 不自動補 .html / 不做尾斜線轉址：/login → login.html 等規則由 Worker 處理（與舊版相同）
      htmlHandling: 'none',
      notFoundHandling: 'none',
      // 以下路徑先進 Worker（Hono）；其餘符合 public/ 檔案的請求由 Static Assets 直接回應，
      // 找不到檔案的請求仍會落到 Worker 的 fallback。
      runWorkerFirst: [
        // API、轉址、健康檢查
        '/api',
        '/api/*',
        '/s/*',
        '/ad/*',
        '/health',
        // HTML 頁面路由
        '/links',
        '/edit/*',
        '/analytics',
        '/analytics/*',
        '/feedback',
        '/feedback/*',
        '/docs',
        '/ui-kit',
        '/admin',
        '/r',
        // 所有 HTML 都經 Worker 注入 ?v=版本號（配合 JS/CSS 長快取）
        '/',
        '/*.html',
      ],
    },
    // Smart Placement：Supabase 在 Frankfurt（eu-central-1），讓 Cloudflare 把 Worker 放在靠近 DB 的位置執行，
    // 減少每個請求多次 DB 往返的延遲（靜態檔由 Static Assets 直接回應，不受影響）
    placement: {
      mode: 'smart',
    },
    observability: {
      enabled: true,
    },
    env: {
      ASSETS: bindings.assets(),
      ROOMS_KV: bindings.kv({ id: ROOMS_KV_NAMESPACE_ID }),
      // 轉址快取：命中時不必連到 Frankfurt 的 Supabase；後端修改／刪除網址或管道時主動清除
      REDIRECT_CACHE: bindings.kv({ id: REDIRECT_CACHE_NAMESPACE_ID }),
      // 一般限流（/api/*、HTML 頁面）：每 IP 每 60 秒 100 次（與舊版 RATE_LIMIT_MAX 相同）
      RATE_LIMITER: bindings.rateLimit({
        namespace: '1001',
        simple: { limit: 100, period: 60 },
      }),
      // 短網址轉址限流（/s/*、/ad/*）：每 IP 每 60 秒 1000 次。
      // 活動現場共用出口 IP（場館 Wi-Fi、電信 CGNAT）大量掃 QR，不能套用一般限流
      REDIRECT_RATE_LIMITER: bindings.rateLimit({
        namespace: '1003',
        simple: { limit: 1000, period: 60 },
      }),
      // 密碼驗證專屬限流（IP + 短碼）：每 60 秒 5 次
      PASSWORD_RATE_LIMITER: bindings.rateLimit({
        namespace: '1002',
        simple: { limit: 5, period: 60 },
      }),
      SUPABASE_URL: bindings.text('https://fsneeigsjdryxutmdrmg.supabase.co'),
      // Publishable key（公開值，前後端 anon 用途）
      SUPABASE_ANON_KEY: bindings.text('sb_publishable_XYMtpVzQz4ge2R1gD1NcaQ_VRXLTvmX'),
      // 對外網域由 Pages 專案提供（pages/_worker.js → service binding → 本 Worker）。
      // 不設 BASE_URL：short_url 以請求的網域為準，換網域不必改設定。
      // CORS_ORIGIN 可用逗號列出多個來源（url.tzuchi.org 已內建於 src/main.ts）。
      CORS_ORIGIN: bindings.text('https://tcurl.pages.dev,https://tcurl.tzuchidigital.workers.dev'),
      SUPABASE_SERVICE_ROLE_KEY: bindings.secret(),
      ADMIN_EMAILS: bindings.secret(),
    },
  },
});
