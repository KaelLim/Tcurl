/**
 * URL 驗證工具 - Deno 版本
 *
 * 防止 SSRF (Server-Side Request Forgery) 攻擊
 *
 * SSRF 攻擊者可能嘗試：
 * - 存取內部服務（localhost、內網 IP）
 * - 讀取雲端 metadata（169.254.169.254）
 * - 使用非 HTTP 協議（file://、gopher://）
 *
 * @module utils/url-validator
 */

/**
 * URL 驗證結果介面
 */
export interface UrlValidationResult {
  /** 是否為有效 URL */
  valid: boolean;
  /** 無效原因（當 valid 為 false 時） */
  reason?: string;
}

/**
 * 檢查 hostname 是否為私有/內部位址
 */
function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // localhost
  if (lower === 'localhost' || lower === 'localhost.localdomain') {
    return true;
  }

  // IPv4 私有範圍
  // 127.0.0.0/8 (loopback)
  if (lower.match(/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
    return true;
  }

  // 10.0.0.0/8 (Class A private)
  if (lower.match(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)) {
    return true;
  }

  // 172.16.0.0/12 (Class B private)
  if (lower.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/)) {
    return true;
  }

  // 192.168.0.0/16 (Class C private)
  if (lower.match(/^192\.168\.\d{1,3}\.\d{1,3}$/)) {
    return true;
  }

  // 169.254.0.0/16 (Link-local, 包含雲端 metadata)
  if (lower.match(/^169\.254\.\d{1,3}\.\d{1,3}$/)) {
    return true;
  }

  // 0.0.0.0
  if (lower === '0.0.0.0') {
    return true;
  }

  // IPv6 loopback
  if (lower === '::1' || lower === '[::1]') {
    return true;
  }

  // IPv6 私有範圍 (簡化檢查)
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
    return true;
  }

  return false;
}

/**
 * 驗證 URL 是否安全
 *
 * 檢查項目：
 * 1. 非空值
 * 2. 長度限制（最大 2048 字元）
 * 3. 有效的 URL 格式
 * 4. 只允許 HTTP/HTTPS 協議
 * 5. 不允許私有/內部位址
 * 6. 不允許危險端口
 *
 * @param urlString - 要驗證的 URL 字串
 * @returns 驗證結果，包含是否有效和原因
 *
 * @example
 * const result = validateUrl('https://example.com')
 * if (!result.valid) {
 *   console.log(result.reason)
 * }
 */
export function validateUrl(urlString: string): UrlValidationResult {
  // 空值檢查
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, reason: 'URL 不可為空' };
  }

  // 去除前後空白
  const trimmed = urlString.trim();

  // 長度限制（防止過長的 URL）
  if (trimmed.length > 2048) {
    return { valid: false, reason: 'URL 長度不可超過 2048 字元' };
  }

  // 嘗試解析 URL
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'URL 格式無效' };
  }

  // 協議檢查 - 只允許 http 和 https
  const allowedProtocols = ['http:', 'https:'];
  if (!allowedProtocols.includes(url.protocol)) {
    return {
      valid: false,
      reason: `不允許的協議: ${url.protocol}，只允許 HTTP 和 HTTPS`,
    };
  }

  // 私有/內部位址檢查
  if (isPrivateHostname(url.hostname)) {
    return {
      valid: false,
      reason: '不允許內部網路位址（localhost、私有 IP）',
    };
  }

  // 檢查是否有 hostname
  if (!url.hostname || url.hostname.length === 0) {
    return { valid: false, reason: 'URL 必須包含有效的域名' };
  }

  // 檢查危險的端口（資料庫/快取服務端口）
  const dangerousPorts = ['6379', '5432', '3306', '27017', '11211', '9200'];
  if (url.port && dangerousPorts.includes(url.port)) {
    return {
      valid: false,
      reason: `不允許存取端口 ${url.port}（資料庫/快取服務端口）`,
    };
  }

  return { valid: true };
}

/**
 * 快速檢查 URL 是否有效（不返回原因）
 *
 * @param urlString - 要驗證的 URL 字串
 * @returns 是否為有效 URL
 */
export function isValidUrl(urlString: string): boolean {
  return validateUrl(urlString).valid;
}
