/**
 * 點擊日誌解析腳本
 *
 * 解析 Nginx 的短網址訪問日誌，批量寫入 url_clicks 表
 *
 * 日誌格式：
 *   $remote_addr|$time_iso8601|$request_uri|$status|$upstream_cache_status|$http_user_agent
 *
 * 使用方式：
 *   npx tsx scripts/parse-click-logs.ts
 *
 * 建議透過 Cron 每 5 分鐘執行一次
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

// 設定
const LOG_FILE = '/var/log/nginx/shorturl-clicks.log'
const POSITION_FILE = path.join(__dirname, '../.click-log-position')
const BATCH_SIZE = 100

// Supabase 客戶端
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface LogEntry {
  ip: string
  timestamp: string
  requestUri: string
  status: string
  cacheStatus: string
  userAgent: string
}

interface ClickRecord {
  url_id: string
  user_agent: string | null
  event_type: string
  clicked_at: string
}

/**
 * 解析單行日誌
 */
function parseLogLine(line: string): LogEntry | null {
  const parts = line.split('|')
  if (parts.length < 6) return null

  return {
    ip: parts[0],
    timestamp: parts[1],
    requestUri: parts[2],
    status: parts[3],
    cacheStatus: parts[4],
    userAgent: parts.slice(5).join('|'), // User-Agent 可能包含 |
  }
}

/**
 * 從 request URI 提取短代碼
 * 例如: /s/xtmzlj?qr=1 -> { shortCode: 'xtmzlj', isQr: true }
 */
function extractShortCode(uri: string): { shortCode: string; isQr: boolean } | null {
  const match = uri.match(/^\/s\/([a-zA-Z0-9_-]+)/)
  if (!match) return null

  const shortCode = match[1]
  const isQr = uri.includes('qr=1') || uri.includes('qr=true')

  return { shortCode, isQr }
}

/**
 * 讀取上次處理的位置
 */
function readLastPosition(): number {
  try {
    if (fs.existsSync(POSITION_FILE)) {
      const content = fs.readFileSync(POSITION_FILE, 'utf-8')
      return parseInt(content, 10) || 0
    }
  } catch {
    // 忽略錯誤
  }
  return 0
}

/**
 * 保存當前處理位置
 */
function savePosition(position: number): void {
  fs.writeFileSync(POSITION_FILE, position.toString())
}

/**
 * 獲取短代碼對應的 URL ID（帶快取）
 */
const urlIdCache = new Map<string, string>()

async function getUrlId(shortCode: string): Promise<string | null> {
  // 檢查快取
  if (urlIdCache.has(shortCode)) {
    return urlIdCache.get(shortCode)!
  }

  // 查詢資料庫
  const { data, error } = await supabase
    .from('urls')
    .select('id')
    .eq('short_code', shortCode)
    .single()

  if (error || !data) {
    return null
  }

  // 存入快取
  urlIdCache.set(shortCode, data.id)
  return data.id
}

/**
 * 批量插入點擊記錄
 */
async function insertClicks(clicks: ClickRecord[]): Promise<number> {
  if (clicks.length === 0) return 0

  const { error } = await supabase
    .from('url_clicks')
    .insert(clicks)

  if (error) {
    console.error('插入點擊記錄失敗:', error.message)
    return 0
  }

  return clicks.length
}

/**
 * 主函數
 */
async function main(): Promise<void> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`點擊日誌解析開始: ${new Date().toISOString()}`)
  console.log('='.repeat(60))

  // 檢查日誌文件是否存在
  if (!fs.existsSync(LOG_FILE)) {
    console.log(`日誌文件不存在: ${LOG_FILE}`)
    console.log('等待 Nginx 產生日誌...')
    return
  }

  // 讀取上次處理的位置
  const lastPosition = readLastPosition()
  const stats = fs.statSync(LOG_FILE)

  // 檢查文件是否被輪替（大小變小）
  if (stats.size < lastPosition) {
    console.log('檢測到日誌輪替，從頭開始處理')
    savePosition(0)
  }

  // 讀取日誌文件
  const fd = fs.openSync(LOG_FILE, 'r')
  const buffer = Buffer.alloc(stats.size - lastPosition)
  fs.readSync(fd, buffer, 0, buffer.length, lastPosition)
  fs.closeSync(fd)

  const content = buffer.toString('utf-8')
  const lines = content.split('\n').filter(line => line.trim())

  if (lines.length === 0) {
    console.log('沒有新的日誌記錄')
    return
  }

  console.log(`發現 ${lines.length} 條新日誌記錄`)

  // 解析並處理日誌
  const clicks: ClickRecord[] = []
  let processed = 0
  let skipped = 0

  for (const line of lines) {
    const entry = parseLogLine(line)
    if (!entry) {
      skipped++
      continue
    }

    // 只處理成功的重定向 (301, 302)
    if (!['301', '302'].includes(entry.status)) {
      skipped++
      continue
    }

    // 提取短代碼
    const result = extractShortCode(entry.requestUri)
    if (!result) {
      skipped++
      continue
    }

    // 獲取 URL ID
    const urlId = await getUrlId(result.shortCode)
    if (!urlId) {
      skipped++
      continue
    }

    // 建立點擊記錄
    clicks.push({
      url_id: urlId,
      user_agent: entry.userAgent || null,
      event_type: result.isQr ? 'qr_scan' : 'link_click',
      clicked_at: entry.timestamp,
    })

    processed++

    // 批量插入
    if (clicks.length >= BATCH_SIZE) {
      const inserted = await insertClicks(clicks)
      console.log(`批量插入 ${inserted} 條記錄`)
      clicks.length = 0
    }
  }

  // 插入剩餘記錄
  if (clicks.length > 0) {
    const inserted = await insertClicks(clicks)
    console.log(`插入 ${inserted} 條記錄`)
  }

  // 保存處理位置
  savePosition(stats.size)

  console.log(`\n處理完成:`)
  console.log(`  已處理: ${processed}`)
  console.log(`  已跳過: ${skipped}`)
  console.log(`  新位置: ${stats.size}`)
  console.log('='.repeat(60))
}

main().catch(console.error)
