/**
 * TCurl - 慈濟短網址系統
 * Deno + Hono 版本
 *
 * @module main
 * @version 2.0.0
 */

import { Hono } from '@hono/hono';
import { cors } from '@hono/cors';
import { secureHeaders } from '@hono/secure-headers';
import { logger } from '@hono/logger';
import { serveStatic } from '@hono/serve-static';

// 載入環境變數
import '@std/dotenv/load';

// 導入路由
import { urlRoutes } from './routes/urls.ts';

// 導入服務
import { initSupabase } from './services/supabase.ts';
import { initRedis } from './services/redis.ts';

// 導入稽核日誌（ISO 27001 A.12.4）
import { createAuditMiddleware, logSystemStart } from './utils/audit-logger.ts';

// 創建 Hono 應用
const app = new Hono();

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
      styleSrc: ["'self'", "'unsafe-inline'", 'cdn.tailwindcss.com', 'fonts.googleapis.com'],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'info.tzuchi.org', '*.tzuchi.org'],
      connectSrc: [
        "'self'",
        Deno.env.get('SUPABASE_URL') || 'https://*.supabase.co',
        'sbeurlpj.tzuchi-org.tw',
        '*.tzuchi-org.tw',
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

// 3. CORS 中間件
const allowedOrigins = [
  'https://url.tzuchi.org',
  Deno.env.get('CORS_ORIGIN'),
  Deno.env.get('DENO_ENV') === 'development' ? 'http://localhost:3000' : undefined,
  Deno.env.get('DENO_ENV') === 'development' ? 'http://localhost:8080' : undefined,
].filter(Boolean) as string[];

app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '*';
      if (allowedOrigins.includes(origin)) return origin;
      console.warn(`CORS blocked origin: ${origin}`);
      return null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

// 4. 速率限制中間件
const rateLimitEnabled = Deno.env.get('RATE_LIMIT_ENABLED') !== 'false';
const rateLimitMax = Number(Deno.env.get('RATE_LIMIT_MAX')) || 100;
const rateLimitWindow = 60 * 1000; // 1 分鐘

// 簡單的內存速率限制器
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

if (rateLimitEnabled) {
  app.use('*', async (c, next) => {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0] ||
      c.req.header('x-real-ip') ||
      'unknown';

    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record || record.resetAt < now) {
      rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindow });
    } else if (record.count >= rateLimitMax) {
      const retryAfter = Math.ceil((record.resetAt - now) / 1000);
      return c.json(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: `請求過於頻繁，請在 ${retryAfter} 秒後重試`,
        },
        429
      );
    } else {
      record.count++;
    }

    return await next();
  });
} else {
  console.warn('⚠️  Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false)');
}

// ============================================================
// 路由配置
// ============================================================

// 健康檢查
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    runtime: 'Deno',
    version: Deno.version.deno,
  });
});

// API 文檔
app.get('/api', (c) => {
  return c.json({
    name: 'TCurl - 慈濟短網址 API',
    version: '2.0.0',
    runtime: 'Deno + Hono',
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
app.route('/', urlRoutes);

// 靜態文件服務（放在最後）- Deno 版本
app.use(
  '/*',
  serveStatic({
    root: './public',
    getContent: async (path: string) => {
      try {
        const file = await Deno.readFile(`./public${path}`);
        return file.buffer as ArrayBuffer;
      } catch {
        // Try index.html for directory paths
        if (!path.includes('.')) {
          try {
            const indexPath = path.endsWith('/') ? `${path}index.html` : `${path}/index.html`;
            const file = await Deno.readFile(`./public${indexPath}`);
            return file.buffer as ArrayBuffer;
          } catch {
            return null;
          }
        }
        return null;
      }
    },
  })
);

// Fallback to index.html for SPA routes
app.get('*', async (c) => {
  try {
    const content = await Deno.readTextFile('./public/index.html');
    return c.html(content);
  } catch {
    return c.text('Not Found', 404);
  }
});

// ============================================================
// 啟動服務器
// ============================================================

const port = Number(Deno.env.get('PORT')) || 3000;
const host = Deno.env.get('HOST') || '0.0.0.0';

// 初始化服務
try {
  await initSupabase();
  await initRedis();
  console.log('✅ Services initialized');
} catch (error) {
  console.error('❌ Failed to initialize services:', error);
}

console.log(`🚀 Server is running on http://${host}:${port}`);
console.log(`📝 API Documentation: http://${host}:${port}/api`);
console.log(`🔗 Short URL format: http://${host}:${port}/s/{code}`);
console.log(`🦕 Runtime: Deno ${Deno.version.deno}`);

// 記錄系統啟動（ISO 27001 A.12.4）
logSystemStart({
  port,
  host,
  environment: Deno.env.get('DENO_ENV') || 'production',
});

Deno.serve({ port, hostname: host }, app.fetch);
