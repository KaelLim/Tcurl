/**
 * 短代碼生成與驗證工具 - Deno 版本
 *
 * 使用 Web Crypto API 生成密碼學安全的隨機短代碼
 *
 * @module utils/shortcode
 */

/**
 * 生成隨機短代碼
 *
 * 使用 Web Crypto API 確保密碼學安全的隨機性
 * 符合 ISO 27001 安全要求
 *
 * @param length - 短代碼長度（預設 6）
 * @returns 隨機生成的短代碼
 */
export function generateShortCode(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = new Uint8Array(length);

  // 使用 Web Crypto API 生成密碼學安全的隨機數
  crypto.getRandomValues(bytes);

  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }

  return result;
}

/**
 * 驗證短代碼格式
 *
 * 短代碼規則：
 * - 只允許字母（大小寫）和數字
 * - 長度必須在 4-20 之間
 *
 * @param code - 要驗證的短代碼
 * @returns 是否為有效的短代碼格式
 */
export function isValidShortCode(code: string): boolean {
  // 只允許字母和數字，長度 4-20
  const regex = /^[a-zA-Z0-9]{4,20}$/;
  return regex.test(code);
}

/**
 * 驗證短代碼是否為保留字
 *
 * 避免與系統路由衝突
 *
 * @param code - 要驗證的短代碼
 * @returns 是否為保留字
 */
export function isReservedShortCode(code: string): boolean {
  const reserved = [
    'api',
    'admin',
    'health',
    'status',
    'links',
    'edit',
    'analytics',
    'docs',
    'static',
    'public',
    'assets',
    'images',
    'css',
    'js',
    'fonts',
    'qrcodes',
  ];

  return reserved.includes(code.toLowerCase());
}

/**
 * 生成唯一的短代碼
 *
 * 結合時間戳確保唯一性（用於緊急情況）
 *
 * @param length - 基礎長度
 * @returns 帶時間戳的短代碼
 */
export function generateUniqueShortCode(length: number = 4): string {
  const base = generateShortCode(length);
  const timestamp = Date.now().toString(36).slice(-4);
  return base + timestamp;
}
