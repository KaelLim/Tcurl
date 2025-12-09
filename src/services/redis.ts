import Redis from 'ioredis'

// 建立 Redis 客戶端
export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,  // 支援密碼認證（可選）
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000)
    return delay
  },
  maxRetriesPerRequest: 3,
  lazyConnect: true
})

// 連接錯誤處理
redis.on('error', (err) => {
  console.error('Redis connection error:', err)
})

redis.on('connect', () => {
  console.log('✅ Redis connected successfully')
})

// 啟動連接
redis.connect().catch((err) => {
  console.error('Failed to connect to Redis:', err)
})

// Redis 快取鍵前綴
export const CACHE_KEYS = {
  URL: (shortCode: string) => `url:${shortCode}`,
  CLICKS: (urlId: string) => `clicks:${urlId}`,
  QR_SCANS: (urlId: string) => `qr_scans:${urlId}`
}

// 快取時間（秒）
export const CACHE_TTL = {
  URL: 3600, // 1小時
  STATS: 60   // 1分鐘
}
