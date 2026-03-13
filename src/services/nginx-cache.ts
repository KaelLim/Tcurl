/**
 * Nginx 快取清除服務 - Deno 版本
 *
 * 直接刪除 Nginx proxy_cache 快取檔案來清除快取。
 * 快取鍵格式：shorturl/s/{code}
 * 快取路徑：/var/cache/nginx/shorturl（levels=1:2）
 *
 * @module services/nginx-cache
 */

import { crypto } from '@std/crypto';
import { encodeHex } from '@std/encoding/hex';

const CACHE_DIR = '/var/cache/nginx/shorturl';

/**
 * 計算快取檔案路徑
 *
 * Nginx proxy_cache levels=1:2 的檔案路徑規則：
 * MD5(cache_key) → 取最後 1 字元為第一層目錄，倒數 2-3 字元為第二層目錄
 * 例如：MD5 = "2e0303a643735c8c9b766448b73dd09d"
 *       路徑 = "d/09/2e0303a643735c8c9b766448b73dd09d"
 */
async function getCacheFilePath(shortCode: string): Promise<string> {
  const cacheKey = `shorturl/s/${shortCode}`;
  const data = new TextEncoder().encode(cacheKey);
  const hashBuffer = await crypto.subtle.digest('MD5', data);
  const md5 = encodeHex(new Uint8Array(hashBuffer));

  // levels=1:2 → 最後 1 字元 / 倒數 2-3 字元 / 完整 hash
  const level1 = md5.slice(-1);
  const level2 = md5.slice(-3, -1);

  return `${CACHE_DIR}/${level1}/${level2}/${md5}`;
}

/**
 * 清除指定短網址的 Nginx 快取
 *
 * 直接刪除快取檔案，下次請求時 Nginx 會自動從後端取得最新回應。
 *
 * @param shortCode 短網址代碼
 * @returns 是否成功清除
 */
export async function purgeNginxCache(shortCode: string): Promise<boolean> {
  try {
    const filePath = await getCacheFilePath(shortCode);

    try {
      await Deno.remove(filePath);
      console.log(`Nginx cache purged: ${filePath} (short code: ${shortCode})`);
      return true;
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        console.debug(`No Nginx cache file for short code: ${shortCode}`);
        return true; // 沒有快取也算成功
      }
      // 權限不足時嘗試用 sudo
      if (err instanceof Deno.errors.PermissionDenied) {
        const cmd = new Deno.Command('sudo', {
          args: ['rm', '-f', filePath],
        });
        const result = await cmd.output();
        if (result.success) {
          console.log(`Nginx cache purged (sudo): ${filePath} (short code: ${shortCode})`);
          return true;
        }
        console.error(`Failed to purge Nginx cache (sudo) for ${shortCode}`);
        return false;
      }
      throw err;
    }
  } catch (error) {
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
