/**
 * Redis 客戶端服務 - Deno 版本
 *
 * 使用 deno.land/x/redis 提供 Redis 快取功能
 *
 * @module services/redis
 */

import { connect, Redis } from 'redis';

// Redis 客戶端實例
let _redis: Redis | null = null;

// Redis 連線配置
const redisConfig = {
  hostname: Deno.env.get('REDIS_HOST') || 'localhost',
  port: Number(Deno.env.get('REDIS_PORT')) || 6379,
  password: Deno.env.get('REDIS_PASSWORD') || undefined,
  maxRetryCount: 3,
};

/**
 * 初始化 Redis 連線
 */
export async function initRedis(): Promise<void> {
  try {
    _redis = await connect({
      hostname: redisConfig.hostname,
      port: redisConfig.port,
      password: redisConfig.password,
      maxRetryCount: redisConfig.maxRetryCount,
    });

    console.log('✅ Redis connected successfully');
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    // 不拋出錯誤，讓服務可以降級運行
    _redis = null;
  }
}

/**
 * 取得 Redis 客戶端
 * 如果未連線則返回 null（降級模式）
 */
export function getRedis(): Redis | null {
  return _redis;
}

/**
 * Redis 快取鍵定義
 */
export const CACHE_KEYS = {
  /** 短網址快取鍵 */
  URL: (shortCode: string): string => `url:${shortCode}`,

  /** 點擊統計快取鍵 */
  CLICKS: (urlId: string): string => `clicks:${urlId}`,

  /** QR 掃描統計快取鍵 */
  QR_SCANS: (urlId: string): string => `qr_scans:${urlId}`,

  /** URL 列表快取鍵 */
  URL_LIST: (page: number, limit: number): string => `urls:list:${page}:${limit}`,

  /** URL 統計快取鍵 */
  URL_STATS: (urlId: string, days: number): string => `url:stats:${urlId}:${days}`,
};

/**
 * 快取時間（秒）
 */
export const CACHE_TTL = {
  /** URL 快取 1 小時 */
  URL: 3600,

  /** 統計快取 1 分鐘 */
  STATS: 60,

  /** 列表快取 5 分鐘 */
  URL_LIST: 300,
};

/**
 * Redis 包裝器 - 提供安全的 Redis 操作
 * 如果 Redis 不可用，操作會優雅降級
 */
export const redis = {
  /**
   * 取得快取值
   */
  async get(key: string): Promise<string | null> {
    if (!_redis) return null;
    try {
      const value = await _redis.get(key);
      return value ?? null;
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  },

  /**
   * 設定快取值（帶過期時間）
   */
  async setex(key: string, seconds: number, value: string): Promise<boolean> {
    if (!_redis) return false;
    try {
      await _redis.setex(key, seconds, value);
      return true;
    } catch (error) {
      console.error(`Redis SETEX error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * 設定快取值（不帶過期時間）
   */
  async set(key: string, value: string): Promise<boolean> {
    if (!_redis) return false;
    try {
      await _redis.set(key, value);
      return true;
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * 刪除快取鍵
   */
  async del(key: string): Promise<boolean> {
    if (!_redis) return false;
    try {
      await _redis.del(key);
      return true;
    } catch (error) {
      console.error(`Redis DEL error for key ${key}:`, error);
      return false;
    }
  },

  /**
   * 批量刪除符合 pattern 的鍵
   */
  async delPattern(pattern: string): Promise<number> {
    if (!_redis) return 0;
    try {
      const keys = await _redis.keys(pattern);
      if (keys.length === 0) return 0;

      let deleted = 0;
      for (const key of keys) {
        await _redis.del(key);
        deleted++;
      }
      return deleted;
    } catch (error) {
      console.error(`Redis DEL pattern error for ${pattern}:`, error);
      return 0;
    }
  },

  /**
   * 檢查 Redis 是否可用
   */
  isConnected(): boolean {
    return _redis !== null;
  },

  /**
   * 關閉 Redis 連線
   */
  async close(): Promise<void> {
    if (_redis) {
      _redis.close();
      _redis = null;
    }
  },
};
