/**
 * Nginx 快取清除服務
 * 用於在更新或刪除短網址時清除 Nginx proxy_cache
 */

import type { FastifyBaseLogger } from 'fastify'

const NGINX_PURGE_BASE_URL = 'http://127.0.0.1:8080/purge/s'

/**
 * 清除指定短網址的 Nginx 快取
 * @param shortCode 短網址代碼
 * @param logger Fastify logger (可選)
 * @returns 是否成功清除
 */
export async function purgeNginxCache(
  shortCode: string,
  logger?: FastifyBaseLogger
): Promise<boolean> {
  try {
    const purgeUrl = `${NGINX_PURGE_BASE_URL}/${shortCode}`
    const response = await fetch(purgeUrl, { method: 'GET' })

    if (response.ok) {
      logger?.info(`Nginx cache purged for short code: ${shortCode}`)
      return true
    }

    // 404 表示快取不存在，也算成功（無需清除）
    if (response.status === 404) {
      logger?.debug(`No Nginx cache found for short code: ${shortCode}`)
      return true
    }

    // 403 表示被拒絕（非本機請求）
    if (response.status === 403) {
      logger?.warn(`Nginx cache purge denied for ${shortCode}: not from localhost`)
      return false
    }

    logger?.warn(
      `Failed to purge Nginx cache for ${shortCode}: HTTP ${response.status}`
    )
    return false
  } catch (error) {
    // 網路錯誤不應阻止主要操作
    logger?.error(
      { err: error },
      `Error purging Nginx cache for short code: ${shortCode}`
    )
    return false
  }
}

/**
 * 批量清除多個短網址的 Nginx 快取
 * @param shortCodes 短網址代碼陣列
 * @param logger Fastify logger (可選)
 * @returns 成功清除的數量
 */
export async function purgeNginxCacheBatch(
  shortCodes: string[],
  logger?: FastifyBaseLogger
): Promise<number> {
  const results = await Promise.all(
    shortCodes.map(code => purgeNginxCache(code, logger))
  )
  return results.filter(Boolean).length
}
