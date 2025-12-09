import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import urlRoutes from './routes/urls.js'

// 載入環境變數
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 創建 Fastify 實例
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname'
      }
    }
  }
})

// 註冊安全 Headers（Helmet）
await fastify.register(helmet, {
  // Content Security Policy - 控制資源載入來源
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",           // Tailwind config 需要 inline script
        "'unsafe-eval'",             // 某些 library 需要 eval
        "cdn.tailwindcss.com",       // Tailwind CSS
        "cdn.jsdelivr.net",          // QRCodeStyling, Chart.js 等
        "unpkg.com",                 // 備用 CDN
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",           // Tailwind 動態樣式
        "cdn.tailwindcss.com",
        "fonts.googleapis.com",
      ],
      fontSrc: [
        "'self'",
        "fonts.gstatic.com",
        "fonts.googleapis.com",
      ],
      imgSrc: [
        "'self'",
        "data:",                     // Base64 圖片（QR Code）
        "blob:",                     // Blob URL
        "info.tzuchi.org",           // 慈濟 favicon
        "*.tzuchi.org",              // 慈濟相關網域
      ],
      connectSrc: [
        "'self'",
        process.env.SUPABASE_URL || "https://*.supabase.co",
        "sbeurlpj.tzuchi-org.tw",    // Supabase 正式環境
        "*.tzuchi-org.tw",           // 慈濟相關網域
        "unpkg.com",                 // CDN source maps
        "cdn.jsdelivr.net",          // Chart.js source maps
      ],
      frameSrc: ["'none'"],          // 禁止 iframe 嵌入
      objectSrc: ["'none'"],         // 禁止 Flash/Java
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  // 其他安全 Headers
  crossOriginEmbedderPolicy: false,  // 允許載入外部資源
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "cross-origin" }, // 允許跨域資源
  dnsPrefetchControl: { allow: true },
  frameguard: { action: "deny" },    // X-Frame-Options: DENY
  hsts: {
    maxAge: 31536000,                // 1 年
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,                     // X-Content-Type-Options: nosniff
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true,                   // X-XSS-Protection
})

// 註冊速率限制（全域）
// 環境變數：
//   RATE_LIMIT_ENABLED=false  → 完全禁用（壓力測試用）
//   RATE_LIMIT_MAX=10000      → 調整每個時間窗口最大請求數
//   RATE_LIMIT_WINDOW=1 minute → 調整時間窗口
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false'
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX) || 100
const rateLimitWindow = process.env.RATE_LIMIT_WINDOW || '1 minute'

if (!rateLimitEnabled) {
  fastify.log.warn('⚠️  Rate limiting is DISABLED (RATE_LIMIT_ENABLED=false)')
}

await fastify.register(rateLimit, {
  global: rateLimitEnabled,
  max: rateLimitMax,
  timeWindow: rateLimitWindow,

  // 自訂錯誤回應
  errorResponseBuilder: (request, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `請求過於頻繁，請在 ${context.after} 後重試`
  }),

  // 根據 IP 識別請求者（支援反向代理）
  keyGenerator: (request) => {
    return request.headers['x-forwarded-for'] as string ||
           request.headers['x-real-ip'] as string ||
           request.ip
  }
})

// 註冊 CORS（白名單模式）
const allowedOrigins = [
  'https://url.tzuchi.org',                    // 生產環境前端
  process.env.CORS_ORIGIN,                     // 自訂來源（從環境變數）
  process.env.NODE_ENV === 'development' && 'http://localhost:3000',
  process.env.NODE_ENV === 'development' && 'http://localhost:8080',
].filter(Boolean) as string[]

await fastify.register(cors, {
  origin: (origin, callback) => {
    // 允許沒有 origin 的請求（如：curl、Postman、同源請求）
    if (!origin) {
      return callback(null, true)
    }
    // 檢查是否在白名單中
    if (allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    // 記錄被拒絕的來源（方便除錯）
    fastify.log.warn(`CORS blocked origin: ${origin}`)
    return callback(new Error('Not allowed by CORS'), false)
  },
  credentials: true,  // 允許攜帶 cookies
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
})

// 註冊路由（必須在靜態文件之前，確保 API 路由優先）
await fastify.register(urlRoutes)

// 健康檢查
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// API 文檔路徑改為 /api
fastify.get('/api', async () => {
  return {
    name: 'TCurl - 慈濟短網址 API',
    version: '1.0.0',
    endpoints: {
      create: 'POST /api/urls',
      list: 'GET /api/urls',
      get: 'GET /api/urls/:id',
      update: 'PUT /api/urls/:id',
      delete: 'DELETE /api/urls/:id',
      redirect: 'GET /s/:shortCode',
      qrcode: 'GET /api/qrcode/:shortCode',
      health: 'GET /health'
    }
  }
})

// 註冊靜態文件服務（放在最後，讓 API 路由優先）
import fastifyStatic from '@fastify/static'
await fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), 'public'),
  prefix: '/'
})

// 啟動服務器
const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000
    const host = process.env.HOST || '0.0.0.0'

    await fastify.listen({ port, host })

    fastify.log.info(`🚀 Server is running on http://${host}:${port}`)
    fastify.log.info(`📝 API Documentation: http://${host}:${port}/`)
    fastify.log.info(`🔗 Short URL format: http://${host}:${port}/s/{code}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
