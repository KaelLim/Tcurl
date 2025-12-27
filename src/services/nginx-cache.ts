/**
 * Nginx 快取清除服務 - Deno 版本
 *
 * 用於在更新或刪除短網址時清除 Nginx proxy_cache
 *
 * @module services/nginx-cache
 */

const NGINX_PURGE_BASE_URL = 'http://127.0.0.1:8080/purge/s';

/**
 * 清除指定短網址的 Nginx 快取
 *
 * @param shortCode 短網址代碼
 * @returns 是否成功清除
 */
export async function purgeNginxCache(shortCode: string): Promise<boolean> {
  try {
    const purgeUrl = `${NGINX_PURGE_BASE_URL}/${shortCode}`;
    const response = await fetch(purgeUrl, { method: 'GET' });

    if (response.ok) {
      console.log(`Nginx cache purged for short code: ${shortCode}`);
      return true;
    }

    // 404 表示快取不存在，也算成功（無需清除）
    if (response.status === 404) {
      console.debug(`No Nginx cache found for short code: ${shortCode}`);
      return true;
    }

    // 403 表示被拒絕（非本機請求）
    if (response.status === 403) {
      console.warn(`Nginx cache purge denied for ${shortCode}: not from localhost`);
      return false;
    }

    console.warn(`Failed to purge Nginx cache for ${shortCode}: HTTP ${response.status}`);
    return false;
  } catch (error) {
    // 網路錯誤不應該阻止主要操作
    console.error(`Error purging Nginx cache for short code: ${shortCode}`, error);
    return false;
  }
}

/**
 * 批量清除多個短網址的 Nginx 快取
 *
 * @param shortCodes 短網址代碼陣列
 * @returns 成功清除的數量
 */
export async function purgeNginxCacheBatch(shortCodes: string[]): Promise<number> {
  const results = await Promise.all(shortCodes.map((code) => purgeNginxCache(code)));
  return results.filter(Boolean).length;
}
