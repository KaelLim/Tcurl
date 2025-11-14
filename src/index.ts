import Fastify from 'fastify'
import cors from '@fastify/cors'
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

// 註冊 CORS
await fastify.register(cors, {
  origin: true // 允許所有來源，生產環境應該限制
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
