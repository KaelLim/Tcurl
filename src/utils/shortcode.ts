import crypto from 'crypto'

/**
 * 生成隨機短代碼
 * 使用 Node.js 內建的 crypto，不需要外部依賴
 */
export function generateShortCode(length: number = 6): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let result = ''
  const bytes = crypto.randomBytes(length)

  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length]
  }

  return result
}

/**
 * 驗證短代碼格式
 */
export function isValidShortCode(code: string): boolean {
  // 只允許字母和數字，長度 4-20
  const regex = /^[a-zA-Z0-9]{4,20}$/
  return regex.test(code)
}
