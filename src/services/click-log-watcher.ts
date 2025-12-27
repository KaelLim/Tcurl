/**
 * Nginx 點擊日誌監聽服務
 *
 * 使用 tail -f 即時監聽 Nginx 日誌，將點擊記錄寫入資料庫
 * 只處理 cache HIT 的請求（cache MISS 已由後端記錄）
 *
 * @module services/click-log-watcher
 */

import { getSupabase } from './supabase.ts';

const LOG_FILE = '/var/log/nginx/shorturl-clicks.log';

// URL ID 快取（避免重複查詢）
const urlIdCache = new Map<string, string>();

/**
 * 解析日誌行
 * 格式：$remote_addr|$time_iso8601|$request_uri|$status|$upstream_cache_status|$http_user_agent
 */
interface LogEntry {
  ip: string;
  timestamp: string;
  requestUri: string;
  status: string;
  cacheStatus: string;
  userAgent: string;
}

function parseLogLine(line: string): LogEntry | null {
  const parts = line.split('|');
  if (parts.length < 6) return null;

  return {
    ip: parts[0],
    timestamp: parts[1],
    requestUri: parts[2],
    status: parts[3],
    cacheStatus: parts[4],
    userAgent: parts.slice(5).join('|'), // User-Agent 可能包含 |
  };
}

/**
 * 從 request URI 提取短代碼
 * 例如: /s/xtmzlj?qr=1 -> { shortCode: 'xtmzlj', isQr: true }
 */
function extractShortCode(uri: string): { shortCode: string; isQr: boolean } | null {
  const match = uri.match(/^\/s\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;

  const shortCode = match[1];
  const isQr = uri.includes('qr=1') || uri.includes('qr=true');

  return { shortCode, isQr };
}

/**
 * 獲取短代碼對應的 URL ID（帶快取）
 */
async function getUrlId(shortCode: string): Promise<string | null> {
  // 檢查快取
  if (urlIdCache.has(shortCode)) {
    return urlIdCache.get(shortCode)!;
  }

  // 查詢資料庫
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('urls')
    .select('id')
    .eq('short_code', shortCode)
    .single();

  if (error || !data) {
    return null;
  }

  // 存入快取
  urlIdCache.set(shortCode, data.id);
  return data.id;
}

/**
 * 記錄點擊到資料庫
 */
async function recordClick(
  urlId: string,
  userAgent: string,
  eventType: string,
  clickedAt: string
): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.from('url_clicks').insert({
    url_id: urlId,
    user_agent: userAgent || null,
    event_type: eventType,
    clicked_at: clickedAt,
  });

  if (error) {
    console.error('[ClickWatcher] 記錄點擊失敗:', error.message);
  }
}

/**
 * 處理單行日誌
 */
async function processLogLine(line: string): Promise<void> {
  const entry = parseLogLine(line);
  if (!entry) return;

  // 只處理成功的重定向 (301, 302)
  if (!['301', '302'].includes(entry.status)) return;

  // 只處理 cache HIT（MISS 已由後端記錄）
  if (entry.cacheStatus !== 'HIT') return;

  // 提取短代碼
  const result = extractShortCode(entry.requestUri);
  if (!result) return;

  // 獲取 URL ID
  const urlId = await getUrlId(result.shortCode);
  if (!urlId) return;

  // 記錄點擊
  const eventType = result.isQr ? 'qr_scan' : 'link_click';
  await recordClick(urlId, entry.userAgent, eventType, entry.timestamp);

  console.log(`[ClickWatcher] 記錄 ${entry.cacheStatus}: ${result.shortCode} (${eventType})`);
}

/**
 * 啟動日誌監聽
 */
export async function startClickLogWatcher(): Promise<void> {
  console.log('[ClickWatcher] 啟動 Nginx 點擊日誌監聽...');

  // 檢查是否啟用（可透過環境變數關閉）
  if (Deno.env.get('CLICK_WATCHER_ENABLED') === 'false') {
    console.log('[ClickWatcher] 已停用 (CLICK_WATCHER_ENABLED=false)');
    return;
  }

  try {
    // 使用 sudo tail -f 監聽日誌（-n 0 表示不讀取歷史記錄）
    const command = new Deno.Command('sudo', {
      args: ['tail', '-n', '0', '-f', LOG_FILE],
      stdout: 'piped',
      stderr: 'piped',
    });

    const process = command.spawn();

    // 處理 stderr（背景執行）
    (async () => {
      const stderrReader = process.stderr.getReader();
      const stderrDecoder = new TextDecoder();
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const text = stderrDecoder.decode(value);
        if (text.trim()) {
          console.error('[ClickWatcher] stderr:', text.trim());
        }
      }
    })();

    // 讀取 stdout
    const reader = process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    console.log(`[ClickWatcher] 監聽日誌: ${LOG_FILE}`);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 處理完整的行
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的行

      for (const line of lines) {
        if (line.trim()) {
          try {
            await processLogLine(line);
          } catch (err) {
            console.error('[ClickWatcher] 處理日誌行失敗:', err);
          }
        }
      }
    }
  } catch (error) {
    console.error('[ClickWatcher] 啟動失敗:', error);
    console.log('[ClickWatcher] 提示: 可能需要 sudo 權限讀取日誌檔案');
  }
}

/**
 * 清除 URL ID 快取（當 URL 被刪除時呼叫）
 */
export function clearUrlIdCache(shortCode?: string): void {
  if (shortCode) {
    urlIdCache.delete(shortCode);
  } else {
    urlIdCache.clear();
  }
}
