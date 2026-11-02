/**
 * TCurl - 慈濟短網址系統
 * Cloudflare Workers + Hono 版本
 *
 * 靜態檔案由 Workers Static Assets（public/）直接提供；
 * 只有 cloudflare.config.ts 的 assets.runWorkerFirst 列出的路徑（API、轉址、HTML 頁面）
 * 與找不到對應檔案的請求才會進到這個 Worker。
 *
 * @module main
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger } from 'hono/logger';

import type { AppEnv } from './types/env.ts';

// 導入路由
import { urlCrudRoutes } from './routes/url-crud.ts';
import { urlRedirectRoutes } from './routes/url-redirect.ts';
import { urlStatsRoutes } from './routes/url-stats.ts';
import { fetchAssetHtml, htmlResponse, urlPageRoutes } from './routes/url-pages.ts';
import { authRoutes } from './routes/auth.ts';
import { urlChannelRoutes } from './routes/url-channels.ts';
import { feedbackRoutes } from './routes/feedbacks.ts';
import { adminRoutes } from './routes/admin.ts';
import { createRoomsRouter } from './routes/rooms.ts';
import { createRoomStore } from './services/room-store.ts';
import { renderRateLimitPage } from './utils/html-templates.ts';

// 導入稽核日誌（ISO 27001 A.12.4）
import { createAuditMiddleware } from './utils/audit-logger.ts';
import { APP_VERSION } from './utils/asset-version.ts';

// 創建 Hono 應用
const app = new Hono<AppEnv>();

// ============================================================
// 中間件配置
// ============================================================

// 1. 日誌中間件
app.use('*', logger());

// 1.5 稽核日誌中間件（ISO 27001 A.12.4）
app.use('*', createAuditMiddleware());

// 2. 安全標頭中間件（符合 ISO 27001）
app.use(
  '*',
  secureHeaders({
    // Content Security Policy
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'cdn.tailwindcss.com',
        'cdn.jsdelivr.net',
        'unpkg.com',
      ],
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.tailwindcss.com', 'fonts.googleapis.com', 'unpkg.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'info.tzuchi.org', '*.tzuchi.org', 'validator.swagger.io', '*.googleusercontent.com'],
      connectSrc: [
        "'self'",
        // Supabase Cloud（cloudflare.config.ts 的 SUPABASE_URL）；前端未使用 Realtime，不需 wss://
        (c) => (c as Context<AppEnv>).env.SUPABASE_URL || 'https://*.supabase.co',
        'unpkg.com',
        'cdn.jsdelivr.net',
      ],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
    // 其他安全標頭
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: 'same-origin',
    crossOriginResourcePolicy: 'cross-origin',
    xFrameOptions: 'DENY',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    xXssProtection: '1; mode=block',
  })
);

// 3. CORS 中間件（允許來源依請求的 env 計算）
function getAllowedOrigins(c: Context<AppEnv>): string[] {
  const isDev = c.env.ENVIRONMENT === 'development';
  return [
    'https://url.tzuchi.org',
    // 可用逗號列出多個來源（例如 Pages 網域與自訂網域並存的過渡期）
    ...(c.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()),
    isDev ? 'http://localhost:3000' : undefined,
    isDev ? 'http://localhost:8080' : undefined,
  ].filter(Boolean) as string[];
}

app.use(
  '*',
  cors({
    origin: (origin, c) => {
      if (!origin) return '*';
      if (getAllowedOrigins(c as Context<AppEnv>).includes(origin)) return origin;
      console.warn(`CORS blocked origin: ${origin}`);
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Room-Pass'],
  })
);

// 4. 速率限制中間件（Workers Rate Limiting binding，鍵為 CF-Connecting-IP）
// - 短網址轉址 /s/*、廣告頁 /ad/*：REDIRECT_RATE_LIMITER（每 IP 每 60 秒 1000 次）。
//   以前 Nginx 快取命中不會進到限流器；現在每次轉址都進 Worker，活動現場共用出口 IP
//   （場館 Wi-Fi、電信 CGNAT）大量掃 QR 時不能套用一般 API 的上限。
// - 其餘路徑（/api/*、HTML 頁面）：RATE_LIMITER（每 IP 每 60 秒 100 次）
// 上限與時間窗設定在 cloudflare.config.ts
const RATE_LIMIT_PERIOD_SECONDS = 60;

/** 轉址類路徑（不套用一般限流，改用 REDIRECT_RATE_LIMITER） */
function isRedirectPath(path: string): boolean {
  // /api/ad/:code/view|click 是廣告頁的計數 API，與轉址同屬活動現場共用 IP 的流量
  return path.startsWith('/s/') || path.startsWith('/ad/') || path.startsWith('/api/ad/');
}

app.use('*', async (c, next) => {
  if (c.env.RATE_LIMIT_ENABLED === 'false') {
    return await next();
  }

  const limiter = isRedirectPath(c.req.path) ? c.env.REDIRECT_RATE_LIMITER : c.env.RATE_LIMITER;
  if (!limiter) {
    return await next();
  }

  const ip = c.req.header('cf-connecting-ip') || 'unknown';

  let success = true;
  try {
    ({ success } = await limiter.limit({ key: ip }));
  } catch (err) {
    // 限流服務異常時放行（fail-open），避免整站無法使用
    console.error('Rate limiter error:', err instanceof Error ? err.message : err);
  }

  if (!success) {
    const retryAfter = RATE_LIMIT_PERIOD_SECONDS;
    // API 路徑回傳 JSON，其餘回傳 HTML 頁面
    if (c.req.path.startsWith('/api/')) {
      return c.json(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `請求過於頻繁，請在 ${retryAfter} 秒後重試`,
        },
        429
      );
    }
    return c.html(renderRateLimitPage(retryAfter), 429);
  }

  return await next();
});

// ============================================================
// 路由配置
// ============================================================

// 版本 API（供前端 badge 自動讀取）
app.get('/api/version', (c) => {
  return c.json({ version: APP_VERSION });
});

// 健康檢查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'Cloudflare Workers',
    version: APP_VERSION,
  });
});

// API 文檔
app.get('/api', (c) => {
  return c.json({
    name: 'TCurl - 慈濟短網址 API',
    version: APP_VERSION,
    runtime: 'Cloudflare Workers + Hono',
    endpoints: {
      create: 'POST /api/urls',
      list: 'GET /api/urls',
      get: 'GET /api/urls/:id',
      update: 'PUT /api/urls/:id',
      delete: 'DELETE /api/urls/:id',
      redirect: 'GET /s/:shortCode',
      health: 'GET /health',
    },
  });
});

// 註冊 URL 路由
// URL 路由（注意順序：stats/summary 必須在 :id 前面）
app.route('/', urlStatsRoutes);
app.route('/', urlCrudRoutes);
app.route('/', urlChannelRoutes);
app.route('/', urlRedirectRoutes);
app.route('/', authRoutes);
app.route('/', urlPageRoutes);

// 註冊社群建議路由
app.route('/', feedbackRoutes);

// 註冊管理員路由
app.route('/', adminRoutes);

// 註冊密語房間路由（POC，免登入，Workers KV）
app.route('/', createRoomsRouter((c) => createRoomStore(c.env.ROOMS_KV)));

// ============================================================
// 靜態檔案 fallback（Workers Static Assets）
// ============================================================

/** 從 ASSETS binding 取檔；不存在回傳 null */
async function fetchAsset(c: Context<AppEnv>, assetPath: string): Promise<Response | null> {
  const res = await c.env.ASSETS.fetch(new URL(assetPath, c.req.url));
  if (!res.ok) {
    await res.body?.cancel();
    return null;
  }
  return res;
}

/**
 * 放在最後：處理 runWorkerFirst 的 HTML 路徑（/、*.html）與找不到檔案的請求。
 * 檔案只能從 ASSETS binding 取得（只含 public/ 內容），不讀本機檔案系統。
 */
app.get('/*', async (c) => {
  const path = c.req.path;

  const asset = await fetchAsset(c, path);
  if (asset) {
    if ((asset.headers.get('content-type') || '').startsWith('text/html')) {
      return htmlResponse(c, await asset.text());
    }
    // 複製成可修改 headers 的 Response（後續中間件會加安全標頭）
    return new Response(asset.body, asset);
  }

  if (!path.includes('.')) {
    const candidates = [
      // 隱藏副檔名：/login → /login.html
      `${path}.html`,
      // 目錄 index.html：/docs/ → /docs/index.html
      path.endsWith('/') ? `${path}index.html` : `${path}/index.html`,
      // SPA fallback
      '/index.html',
    ];
    for (const candidate of candidates) {
      const raw = await fetchAssetHtml(c, candidate);
      if (raw !== null) {
        return htmlResponse(c, raw);
      }
    }
  }

  return c.text('Not Found', 404);
});

// ============================================================
// Workers 進入點
// ============================================================

export default app;
