/**
 * 轉址快取（Workers KV：REDIRECT_CACHE）
 *
 * /s/:code 先查 KV，命中時不必連到 Supabase（Frankfurt），活動現場大量掃碼時也能減輕資料庫負擔。
 *
 * - 只存轉址需要的欄位；**不存密碼雜湊**（只存「是否需要密碼」，驗證密碼一律查資料庫）
 * - 每筆帶寫入時間，超過 CACHE_TTL_SECONDS 視為未命中：KV 邊緣快取可能多留一段時間，
 *   以寫入時間判斷才能確保「最多 60 秒」
 * - 找不到的短碼不快取（剛建立的短網址馬上可用）
 * - KV 任何錯誤都當成未命中／略過，轉址退回資料庫，不因快取故障而失敗
 *
 * 後端修改／刪除網址或管道時呼叫 invalidate*：同一機房立即生效，其他機房最多 60 秒。
 *
 * @module services/redirect-cache
 */

/** 快取有效秒數（KV expirationTtl 最小值為 60） */
export const CACHE_TTL_SECONDS = 60;

/** 轉址需要的網址欄位 */
export interface CachedUrl {
  id: string;
  original_url: string;
  expires_at: string | null;
  requires_password: boolean;
}

/** 轉址需要的管道欄位（附加 UTM、記錄 channel_id） */
export interface CachedChannel {
  id: string;
  name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
}

type Entry<T> = { value: T; cached_at: number };
type Kv = KVNamespace | undefined;

const urlKey = (shortCode: string) => `url:${shortCode}`;
const channelKey = (urlId: string, groupKey: string) => `ch:${urlId}:${groupKey}`;

async function read<T>(kv: Kv, key: string): Promise<T | null> {
  if (!kv) return null;
  try {
    const entry = await kv.get<Entry<T>>(key, 'json');
    if (!entry || typeof entry.cached_at !== 'number') return null;
    if (Date.now() - entry.cached_at > CACHE_TTL_SECONDS * 1000) return null;
    return entry.value;
  } catch (err) {
    console.warn(`[RedirectCache] read ${key} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function write<T>(kv: Kv, key: string, value: T): Promise<void> {
  if (!kv) return;
  const entry: Entry<T> = { value, cached_at: Date.now() };
  try {
    await kv.put(key, JSON.stringify(entry), { expirationTtl: CACHE_TTL_SECONDS });
  } catch (err) {
    // 例如同一個 key 每秒最多寫 1 次（429）：略過即可，下一次請求再寫
    console.warn(`[RedirectCache] write ${key} failed:`, err instanceof Error ? err.message : err);
  }
}

async function remove(kv: Kv, key: string): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(key);
  } catch (err) {
    console.warn(`[RedirectCache] delete ${key} failed:`, err instanceof Error ? err.message : err);
  }
}

/** 從 urls 資料列取出轉址需要的欄位（不含密碼雜湊） */
export function toCachedUrl(row: {
  id: string;
  original_url: string;
  expires_at: string | null;
  password_protected: boolean | null;
  password_hash: string | null;
}): CachedUrl {
  return {
    id: row.id,
    original_url: row.original_url,
    expires_at: row.expires_at,
    requires_password: !!(row.password_protected && row.password_hash),
  };
}

/** 從 url_channels 資料列取出轉址需要的欄位 */
export function toCachedChannel(row: CachedChannel): CachedChannel {
  return {
    id: row.id,
    name: row.name ?? null,
    utm_source: row.utm_source ?? null,
    utm_medium: row.utm_medium ?? null,
    utm_campaign: row.utm_campaign ?? null,
    utm_content: row.utm_content ?? null,
    utm_term: row.utm_term ?? null,
  };
}

export const getCachedUrl = (kv: Kv, shortCode: string) => read<CachedUrl>(kv, urlKey(shortCode));

export const putCachedUrl = (kv: Kv, shortCode: string, value: CachedUrl) =>
  write(kv, urlKey(shortCode), value);

export const invalidateUrl = (kv: Kv, shortCode: string) => remove(kv, urlKey(shortCode));

export const getCachedChannel = (kv: Kv, urlId: string, groupKey: string) =>
  read<CachedChannel>(kv, channelKey(urlId, groupKey));

export const putCachedChannel = (kv: Kv, urlId: string, groupKey: string, value: CachedChannel) =>
  write(kv, channelKey(urlId, groupKey), value);

export const invalidateChannel = (kv: Kv, urlId: string, groupKey: string) =>
  remove(kv, channelKey(urlId, groupKey));
