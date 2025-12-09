import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { supabase, createUserClient, extractToken } from '../services/supabase.js'
import { redis, CACHE_KEYS, CACHE_TTL } from '../services/redis.js'
import { purgeNginxCache } from '../services/nginx-cache.js'
import { generateShortCode, isValidShortCode } from '../utils/shortcode.js'
import { validateUrl } from '../utils/url-validator.js'
// Server-side QR Code generation disabled - using client-side generation instead
// import { generateQRCode, generateQRCodeBase64 } from '../utils/qrcode.js'
// import { getTheme, isValidThemeId, mergeThemeOptions, getDefaultTheme } from '../utils/qr-themes.js'
import { CreateURLRequest, URLRecord } from '../types/index.js'
import { renderPasswordPage, renderExpiredPage, renderAdPage } from '../utils/html-templates.js'
import bcrypt from 'bcrypt'

/**
 * 輔助函數：從請求中取得使用者 Supabase Client
 * 如果沒有有效的 Token，回傳 null
 */
function getUserClientFromRequest(request: FastifyRequest) {
  const token = extractToken(request.headers.authorization)
  if (!token) {
    return null
  }
  return createUserClient(token)
}

/**
 * 輔助函數：回傳未授權錯誤
 */
function sendUnauthorized(reply: FastifyReply) {
  return reply.code(401).send({
    error: 'Unauthorized',
    message: '請先登入'
  })
}

export default async function urlRoutes(fastify: FastifyInstance) {
  // 創建短網址（需要登入）
  fastify.post<{ Body: CreateURLRequest }>('/api/urls', async (request, reply) => {
    // 驗證使用者登入
    const userClient = getUserClientFromRequest(request)
    if (!userClient) {
      return sendUnauthorized(reply)
    }

    const { original_url, short_code, expires_at } = request.body

    // 驗證原始 URL
    if (!original_url) {
      return reply.code(400).send({ error: 'original_url is required' })
    }

    // URL 格式與安全性驗證（防止 SSRF 攻擊）
    const urlValidation = validateUrl(original_url)
    if (!urlValidation.valid) {
      return reply.code(400).send({
        error: 'Invalid URL',
        message: urlValidation.reason
      })
    }

    // 取得使用者 ID
    const token = extractToken(request.headers.authorization)
    const { data: { user }, error: userError } = await supabase.auth.getUser(token!)

    if (userError || !user) {
      return reply.code(401).send({ error: 'Invalid token' })
    }

    // 驗證自訂短代碼格式
    if (short_code && !isValidShortCode(short_code)) {
      return reply.code(400).send({ error: 'Invalid short code format' })
    }

    // 插入資料庫（使用重試機制處理競爭條件）
    const maxAttempts = 10
    let attempts = 0
    let data = null
    let lastError = null

    while (attempts < maxAttempts) {
      // 使用自訂短代碼或生成新的
      const currentShortCode = short_code || generateShortCode(Number(process.env.SHORT_CODE_LENGTH) || 6)

      const { data: insertedData, error } = await userClient
        .from('urls')
        .insert({
          short_code: currentShortCode,
          original_url,
          expires_at,
          created_by: user.id
        })
        .select()
        .single()

      if (!error) {
        // 插入成功
        data = insertedData
        break
      }

      // 檢查是否為 UNIQUE 違反錯誤（PostgreSQL error code: 23505）
      if (error.code === '23505') {
        if (short_code) {
          // 使用者自訂的短代碼已存在，不重試
          return reply.code(409).send({ error: 'Short code already exists' })
        }
        // 自動生成的短代碼衝突，重試
        attempts++
        lastError = error
        continue
      }

      // 其他錯誤，直接返回
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to create short URL' })
    }

    if (!data) {
      fastify.log.error({ attempts, lastError }, 'Failed to generate unique short code after max attempts')
      return reply.code(500).send({ error: 'Failed to generate unique short code' })
    }

    // 不再自動生成 QR Code，由用戶決定是否生成
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    const shortUrl = `${baseUrl}/s/${data.short_code}`

    return reply.code(201).send({
      ...data,
      short_url: shortUrl
    })
  })

  // 獲取所有短網址列表（需要登入，RLS 自動過濾只顯示自己的）
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/urls',
    async (request, reply) => {
      // 驗證使用者登入
      const userClient = getUserClientFromRequest(request)
      if (!userClient) {
        return sendUnauthorized(reply)
      }

      const page = parseInt(request.query.page || '1')
      const limit = parseInt(request.query.limit || '10')
      const offset = (page - 1) * limit

      // 使用 user client 查詢，RLS 會自動過濾只顯示該使用者的 URLs
      // 取得總數
      const { count, error: countError } = await userClient
        .from('urls')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true)

      if (countError) {
        fastify.log.error(countError)
        return reply.code(500).send({ error: 'Failed to count URLs' })
      }

      // 取得分頁資料
      const { data: urlsData, error: urlsError } = await userClient
        .from('urls')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (urlsError) {
        fastify.log.error(urlsError)
        return reply.code(500).send({ error: 'Failed to fetch URLs' })
      }

      // 取得點擊統計（使用 service client 查詢 url_clicks）
      const urlIds = urlsData?.map(u => u.id) || []
      let statsMap = new Map<string, { total: number; link: number; qr: number; last: string | null }>()

      if (urlIds.length > 0) {
        const { data: clicksData } = await supabase
          .from('url_clicks')
          .select('url_id, event_type, clicked_at')
          .in('url_id', urlIds)

        // 計算每個 URL 的統計
        for (const urlId of urlIds) {
          const clicks = clicksData?.filter(c => c.url_id === urlId) || []
          const linkClicks = clicks.filter(c => c.event_type === 'link_click' || c.event_type === 'ad_click').length
          const qrScans = clicks.filter(c => c.event_type === 'qr_scan').length
          const lastClick = clicks.length > 0
            ? clicks.sort((a, b) => new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime())[0].clicked_at
            : null

          statsMap.set(urlId, {
            total: clicks.length,
            link: linkClicks,
            qr: qrScans,
            last: lastClick
          })
        }
      }

      // 合併資料
      const mergedData = urlsData?.map(url => {
        const stats = statsMap.get(url.id) || { total: 0, link: 0, qr: 0, last: null }
        return {
          id: url.id,
          short_code: url.short_code,
          original_url: url.original_url,
          created_at: url.created_at,
          is_active: url.is_active,
          clicks: stats.total,
          link_clicks: stats.link,
          qr_scans: stats.qr,
          last_clicked_at: stats.last,
          qr_code_generated: url.qr_code_generated || false,
          qr_code_path: url.qr_code_path,
          qr_code_options: url.qr_code_options,
          password_protected: url.password_protected || false,
          expires_at: url.expires_at,
          created_by: url.created_by
        }
      })

      const totalPages = Math.ceil((count || 0) / limit)

      // 設定防快取 headers，確保每次都取得最新資料
      reply.header('Cache-Control', 'no-cache, no-store, must-revalidate')
      reply.header('Pragma', 'no-cache')
      reply.header('Expires', '0')

      return reply.send({
        data: mergedData,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      })
    }
  )

  // 獲取單個短網址詳情（需要登入，RLS 確保只能看自己的）
  fastify.get<{ Params: { id: string } }>('/api/urls/:id', async (request, reply) => {
    // 驗證使用者登入
    const userClient = getUserClientFromRequest(request)
    if (!userClient) {
      return sendUnauthorized(reply)
    }

    const { id } = request.params

    const { data, error } = await userClient
      .from('urls')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'URL not found' })
    }

    return reply.send(data)
  })

  // 更新短網址（需要登入，RLS 確保只能更新自己的）
  fastify.put<{ Params: { id: string }; Body: Partial<CreateURLRequest> }>(
    '/api/urls/:id',
    async (request, reply) => {
      // 驗證使用者登入
      const userClient = getUserClientFromRequest(request)
      if (!userClient) {
        return sendUnauthorized(reply)
      }

      const { id } = request.params
      const { password, password_protected, ...otherUpdates } = request.body

      // 準備更新資料
      const updates: any = { ...otherUpdates }

      // 處理密碼保護
      if (password_protected !== undefined) {
        updates.password_protected = password_protected

        if (password_protected && password) {
          // 啟用密碼保護且提供新密碼，進行 hash
          const saltRounds = 10
          updates.password_hash = await bcrypt.hash(password, saltRounds)
        } else if (!password_protected) {
          // 停用密碼保護，清除 hash
          updates.password_hash = null
        }
      } else if (password) {
        // 只更新密碼（不改變 password_protected 狀態）
        const saltRounds = 10
        updates.password_hash = await bcrypt.hash(password, saltRounds)
        updates.password_protected = true
      }

      // 如果更新 original_url，需要驗證（防止 SSRF）
      if (updates.original_url) {
        const urlValidation = validateUrl(updates.original_url)
        if (!urlValidation.valid) {
          return reply.code(400).send({
            error: 'Invalid URL',
            message: urlValidation.reason
          })
        }
      }

      const { data, error } = await userClient
        .from('urls')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error || !data) {
        return reply.code(404).send({ error: 'URL not found' })
      }

      // 清除快取（Redis + Nginx）
      try {
        const cacheKey = CACHE_KEYS.URL(data.short_code)
        await redis.del(cacheKey)
        await purgeNginxCache(data.short_code, fastify.log)
        fastify.log.info(`Cache invalidated for ${data.short_code} after update`)
      } catch (cacheError) {
        fastify.log.error({ err: cacheError }, 'Failed to invalidate cache')
      }

      return reply.send(data)
    }
  )

  // 更新 QR Code 配置並保存 PNG（需要登入，RLS 確保只能更新自己的）
  fastify.patch<{
    Params: { id: string }
    Body: {
      qr_code_options: any
      qr_code_data_url?: string  // Base64 PNG data URL from client
    }
  }>(
    '/api/urls/:id/qr-code',
    async (request, reply) => {
      // 驗證使用者登入
      const userClient = getUserClientFromRequest(request)
      if (!userClient) {
        return sendUnauthorized(reply)
      }

      const { id } = request.params
      const { qr_code_options, qr_code_data_url } = request.body

      if (!qr_code_options) {
        return reply.code(400).send({ error: 'qr_code_options is required' })
      }

      // 先獲取 URL 資料（使用 user client，RLS 會確保只能取得自己的）
      const { data: urlData, error: fetchError } = await userClient
        .from('urls')
        .select('short_code, qr_code_path')
        .eq('id', id)
        .single()

      if (fetchError || !urlData) {
        return reply.code(404).send({ error: 'URL not found' })
      }

      // 準備更新資料
      const updates: any = {
        qr_code_options: qr_code_options,  // jsonb type, no need to stringify
        qr_code_generated: true
      }

      // 如果提供了 PNG data URL，保存為檔案
      if (qr_code_data_url) {
        try {
          const fs = await import('fs/promises')
          const path = await import('path')

          // 確保 qrcodes 目錄存在
          const qrcodesDir = path.join(process.cwd(), 'public', 'qrcodes')
          await fs.mkdir(qrcodesDir, { recursive: true })

          // 解析 base64 data URL
          const matches = qr_code_data_url.match(/^data:image\/png;base64,(.+)$/)
          if (!matches) {
            throw new Error('Invalid data URL format')
          }

          const base64Data = matches[1]
          const buffer = Buffer.from(base64Data, 'base64')

          // 驗證檔案大小（最大 1MB）
          const maxSize = 1 * 1024 * 1024  // 1MB
          if (buffer.length > maxSize) {
            return reply.code(400).send({
              error: 'QR Code 檔案過大',
              message: `檔案大小 ${(buffer.length / 1024).toFixed(1)}KB 超過限制（最大 1MB）`
            })
          }

          // 驗證 PNG 格式（檢查 PNG 檔頭簽名）
          const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
          if (buffer.length < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
            return reply.code(400).send({
              error: '無效的 PNG 檔案格式',
              message: '上傳的檔案不是有效的 PNG 圖片'
            })
          }

          // 保存檔案
          const fileName = `${urlData.short_code}.png`
          const filePath = path.join(qrcodesDir, fileName)
          await fs.writeFile(filePath, buffer)

          // 更新資料庫路徑
          updates.qr_code_path = `/qrcodes/${fileName}`

          fastify.log.info(`QR Code PNG saved: ${filePath}`)
        } catch (saveError) {
          fastify.log.error({ err: saveError }, 'Failed to save QR Code PNG')
          return reply.code(500).send({ error: 'Failed to save QR Code image' })
        }
      }

      // 更新資料庫（使用 user client）
      const { data, error } = await userClient
        .from('urls')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error || !data) {
        fastify.log.error({ err: error, updates }, 'Failed to update QR Code config')
        return reply.code(500).send({
          error: 'Failed to update QR Code configuration',
          details: error?.message || 'Unknown error'
        })
      }

      // 清除快取（Redis + Nginx）
      try {
        const cacheKey = CACHE_KEYS.URL(urlData.short_code)
        await redis.del(cacheKey)
        await purgeNginxCache(urlData.short_code, fastify.log)
        fastify.log.info(`Cache invalidated for ${urlData.short_code} after QR update`)
      } catch (cacheError) {
        fastify.log.error({ err: cacheError }, 'Failed to invalidate cache')
      }

      return reply.send({
        success: true,
        qr_code_path: updates.qr_code_path,
        qr_code_options: qr_code_options
      })
    }
  )

  // 刪除短網址（需要登入，RLS 確保只能刪除自己的）
  fastify.delete<{ Params: { id: string } }>('/api/urls/:id', async (request, reply) => {
    // 驗證使用者登入
    const userClient = getUserClientFromRequest(request)
    if (!userClient) {
      return sendUnauthorized(reply)
    }

    const { id } = request.params

    // 先取得資料以便清除快取（使用 user client，RLS 確保只能取得自己的）
    const { data: urlData } = await userClient
      .from('urls')
      .select('short_code, qr_code_path')
      .eq('id', id)
      .single()

    if (!urlData) {
      return reply.code(404).send({ error: 'URL not found' })
    }

    // 刪除 QR Code 檔案（如果存在）
    if (urlData.qr_code_path) {
      try {
        const fs = await import('fs/promises')
        const path = await import('path')
        const filePath = path.join(process.cwd(), 'public', urlData.qr_code_path)
        await fs.unlink(filePath)
        fastify.log.info(`QR code file deleted: ${filePath}`)
      } catch (fileError) {
        fastify.log.error({ err: fileError }, 'Failed to delete QR code file')
      }
    }

    // 從資料庫真正刪除（使用 user client）
    const { error } = await userClient
      .from('urls')
      .delete()
      .eq('id', id)

    if (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to delete URL' })
    }

    // 清除快取（Redis + Nginx）
    try {
      const cacheKey = CACHE_KEYS.URL(urlData.short_code)
      await redis.del(cacheKey)
      await purgeNginxCache(urlData.short_code, fastify.log)
      fastify.log.info(`Cache invalidated for ${urlData.short_code} after deletion`)
    } catch (cacheError) {
      fastify.log.error({ err: cacheError }, 'Failed to invalidate cache')
    }

    return reply.send({ message: 'URL deleted successfully' })
  })

  // ======== Server-side QR Code routes disabled - using client-side generation ========
  // All QR Codes are now generated in the browser using qr-code-styling library

  /* DISABLED: Server-side QR Code generation
  // 生成/更新 QR Code（使用主題或自訂選項）
  fastify.post<{
    Params: { id: string }
    Body: { themeId?: string; customOptions?: any }
  }>('/api/urls/:id/qrcode', async (request, reply) => {
    const { id } = request.params
    const { themeId, customOptions } = request.body

    // 查詢 URL 記錄
    const { data: urlData, error: urlError } = await supabase
      .from('urls')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .single()

    if (urlError || !urlData) {
      return reply.code(404).send({ error: 'URL not found' })
    }

    // 決定使用的選項
    let qrOptions
    if (themeId) {
      // 使用主題
      if (!isValidThemeId(themeId)) {
        return reply.code(400).send({ error: 'Invalid theme ID' })
      }
      qrOptions = mergeThemeOptions(themeId, customOptions)
    } else if (customOptions) {
      // 使用完全自訂
      const defaultTheme = getDefaultTheme()
      qrOptions = { ...defaultTheme.options, ...customOptions }
    } else {
      // 使用預設主題
      const defaultTheme = getDefaultTheme()
      qrOptions = defaultTheme.options
    }

    // 生成 QR Code（加上 ?qr=true 參數以追蹤 QR 掃描）
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    const shortUrl = `${baseUrl}/s/${urlData.short_code}?qr=true`

    try {
      const qrPath = await generateQRCode(shortUrl, urlData.short_code, qrOptions)

      // 更新資料庫
      const { data: updated, error: updateError } = await supabase
        .from('urls')
        .update({
          qr_code_generated: true,
          qr_code_path: qrPath,
          qr_code_options: { themeId, ...qrOptions }
        })
        .eq('id', id)
        .select()
        .single()

      if (updateError) {
        fastify.log.error(updateError)
        return reply.code(500).send({ error: 'Failed to update QR code' })
      }

      return reply.send({
        ...updated,
        qr_code: qrPath,
        short_url: shortUrl
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to generate QR code' })
    }
  })

  // 預覽 QR Code（不儲存）
  fastify.post<{
    Body: { url?: string; themeId?: string; customOptions?: any }
  }>('/api/urls/qrcode/preview', async (request, reply) => {
    const { url, themeId, customOptions } = request.body

    if (!url) {
      return reply.code(400).send({ error: 'URL is required' })
    }

    // 決定使用的選項
    let qrOptions
    if (themeId) {
      if (!isValidThemeId(themeId)) {
        return reply.code(400).send({ error: 'Invalid theme ID' })
      }
      qrOptions = mergeThemeOptions(themeId, customOptions)
    } else if (customOptions) {
      const defaultTheme = getDefaultTheme()
      qrOptions = { ...defaultTheme.options, ...customOptions }
    } else {
      const defaultTheme = getDefaultTheme()
      qrOptions = defaultTheme.options
    }

    try {
      const qrBase64 = await generateQRCodeBase64(url, qrOptions)
      return reply.send({ qr_code: qrBase64 })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to generate QR code preview' })
    }
  })

  // 取得 URL 的 QR Code 設定
  fastify.get<{ Params: { id: string } }>(
    '/api/urls/:id/qrcode/options',
    async (request, reply) => {
      const { id } = request.params

      const { data, error } = await supabase
        .from('urls')
        .select('qr_code_options, qr_code_generated, qr_code_path')
        .eq('id', id)
        .eq('is_active', true)
        .single()

      if (error || !data) {
        return reply.code(404).send({ error: 'URL not found' })
      }

      return reply.send({
        qr_code_generated: data.qr_code_generated,
        qr_code_path: data.qr_code_path,
        qr_code_options: data.qr_code_options
      })
    }
  )

  // 取得所有可用的 QR Code 主題
  fastify.get('/api/qrcode/themes', async (request, reply) => {
    const { getAllThemes } = await import('../utils/qr-themes.js')
    const themes = getAllThemes()
    return reply.send({ themes })
  })

  // 獲取 QR Code（Base64 格式，舊的向後相容端點）
  fastify.get<{ Params: { shortCode: string } }>(
    '/api/qrcode/:shortCode',
    async (request, reply) => {
      const { shortCode } = request.params

      const { data } = await supabase
        .from('urls')
        .select('short_code')
        .eq('short_code', shortCode)
        .eq('is_active', true)
        .single()

      if (!data) {
        return reply.code(404).send({ error: 'Short URL not found' })
      }

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      const shortUrl = `${baseUrl}/s/${shortCode}?qr=true`

      try {
        const qrBase64 = await generateQRCodeBase64(shortUrl)
        return reply.send({ qr_code: qrBase64 })
      } catch (error) {
        fastify.log.error(error)
        return reply.code(500).send({ error: 'Failed to generate QR code' })
      }
    }
  )
  */ // End of disabled server-side QR Code routes

  // 驗證密碼保護的短網址（嚴格速率限制：5次/分鐘，防止暴力破解）
  fastify.post<{
    Params: { shortCode: string }
    Body: { password: string }
  }>('/api/urls/:shortCode/verify-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { shortCode } = request.params
    const { password } = request.body

    if (!password) {
      return reply.code(400).send({ error: 'Password is required' })
    }

    // 查詢 URL 記錄
    const { data, error } = await supabase
      .from('urls')
      .select('*')
      .eq('short_code', shortCode)
      .eq('is_active', true)
      .single()

    if (error || !data) {
      return reply.code(404).send({ error: 'Short URL not found' })
    }

    // 檢查過期
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return reply.code(410).send({ error: 'Short URL has expired' })
    }

    // 檢查是否設定密碼保護
    if (!data.password_protected || !data.password_hash) {
      return reply.code(400).send({ error: 'This URL is not password protected' })
    }

    // 驗證密碼（加入固定延遲防止 Timing Attack）
    const startTime = Date.now()
    const isValid = await bcrypt.compare(password, data.password_hash)
    const elapsed = Date.now() - startTime

    // 確保總回應時間至少 500ms，防止時序攻擊
    const minDelay = 500
    if (elapsed < minDelay) {
      await new Promise(resolve => setTimeout(resolve, minDelay - elapsed))
    }

    if (!isValid) {
      return reply.code(401).send({ error: 'Invalid password' })
    }

    // 密碼正確，記錄點擊
    Promise.resolve(
      supabase.from('url_clicks').insert({
        url_id: data.id,
        user_agent: request.headers['user-agent'] || null,
        event_type: 'link_click'
      })
    ).catch((err: Error) => {
      fastify.log.error({ err, url_id: data.id }, 'Failed to record click after password verification')
    })

    // 返回原始 URL
    return reply.send({
      original_url: data.original_url,
      short_code: data.short_code
    })
  })

  // 短網址重定向（使用 Redis 快取）
  fastify.get<{ Params: { shortCode: string }; Querystring: { qr?: string } }>(
    '/s/:shortCode',
    async (request, reply) => {
      const { shortCode } = request.params
      const { qr } = request.query
      const isQrScan = qr === '1' || qr === 'true'

      try {
        // 1. 先查 Redis 快取
        const cacheKey = CACHE_KEYS.URL(shortCode)
        const cached = await redis.get(cacheKey)

        if (cached) {
          // 快取命中
          const cachedData = JSON.parse(cached)

          // 檢查過期時間
          if (cachedData.expires_at && new Date(cachedData.expires_at) < new Date()) {
            // 清除已過期的快取
            await redis.del(cacheKey)
            return reply.type('text/html').send(renderExpiredPage(cachedData.expires_at))
          }

          // 檢查是否需要密碼保護
          if (cachedData.password_protected && cachedData.password_hash) {
            return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan))
          }

          // 異步記錄點擊
          Promise.resolve(
            supabase.from('url_clicks').insert({
              url_id: cachedData.id,
              user_agent: request.headers['user-agent'] || null,
              event_type: isQrScan ? 'qr_scan' : 'link_click'
            })
          ).catch((err: Error) => {
            fastify.log.error({ err, url_id: cachedData.id, shortCode }, 'Failed to record click (cache hit)')
          })

          fastify.log.info(`Cache hit for ${shortCode}`)
          return reply.redirect(cachedData.original_url, 302)
        }

        // 2. 快取未命中，查詢資料庫
        const { data, error } = await supabase
          .from('urls')
          .select('*')
          .eq('short_code', shortCode)
          .eq('is_active', true)
          .single()

        if (error || !data) {
          return reply.code(404).send({ error: 'Short URL not found' })
        }

        // 檢查過期時間
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          // 返回過期頁面
          return reply.type('text/html').send(renderExpiredPage(data.expires_at))
        }

        // 檢查是否需要密碼保護
        if (data.password_protected && data.password_hash) {
          // 返回密碼驗證頁面
          return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan))
        }

        // 3. 存入 Redis 快取（包含密碼保護和過期資訊）
        await redis.setex(cacheKey, CACHE_TTL.URL, JSON.stringify({
          id: data.id,
          original_url: data.original_url,
          short_code: data.short_code,
          password_protected: data.password_protected,
          password_hash: data.password_hash,
          expires_at: data.expires_at
        }))

        // 4. 記錄點擊（只記錄必要資訊）
        Promise.resolve(
          supabase.from('url_clicks').insert({
            url_id: data.id,
            user_agent: request.headers['user-agent'] || null,
            event_type: isQrScan ? 'qr_scan' : 'link_click'
          })
        ).catch((err: Error) => {
          fastify.log.error({ err, url_id: data.id, shortCode }, 'Failed to record click (cache miss)')
        })

        fastify.log.info(`Cache miss for ${shortCode}, cached now`)

        // 6. 重定向
        return reply.redirect(data.original_url, 302)
      } catch (redisError) {
        // Redis 錯誤不應該影響服務，降級為直接查資料庫
        fastify.log.error({ err: redisError }, 'Redis error, falling back to database')

        const { data, error } = await supabase
          .from('urls')
          .select('*')
          .eq('short_code', shortCode)
          .eq('is_active', true)
          .single()

        if (error || !data) {
          return reply.code(404).send({ error: 'Short URL not found' })
        }

        // 檢查過期時間
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          return reply.type('text/html').send(renderExpiredPage(data.expires_at))
        }

        // 檢查是否需要密碼保護
        if (data.password_protected && data.password_hash) {
          return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan))
        }

        // 記錄點擊
        Promise.resolve(
          supabase.from('url_clicks').insert({
            url_id: data.id,
            user_agent: request.headers['user-agent'] || null,
            event_type: isQrScan ? 'qr_scan' : 'link_click'
          })
        ).catch((err: Error) => {
          fastify.log.error({ err, url_id: data.id, shortCode }, 'Failed to record click (Redis fallback)')
        })

        return reply.redirect(data.original_url, 302)
      }
    }
  )

  // ========== 廣告頁路由 ==========

  // 廣告頁面 - 顯示廣告和防詐騙提示
  fastify.get<{ Params: { shortCode: string } }>(
    '/ad/:shortCode',
    async (request, reply) => {
      const { shortCode } = request.params

      try {
        // 查詢短網址資料
        const { data, error } = await supabase
          .from('urls')
          .select('id, original_url, is_active, expires_at')
          .eq('short_code', shortCode)
          .single()

        if (error || !data) {
          return reply.code(404).type('text/html').send(
            `<html><body><h1>短網址不存在</h1><p>此短網址可能已被刪除或從未建立</p><a href="/">返回首頁</a></body></html>`
          )
        }

        // 檢查是否停用
        if (!data.is_active) {
          return reply.code(410).type('text/html').send(
            `<html><body><h1>短網址已停用</h1><p>此短網址已被停用</p><a href="/">返回首頁</a></body></html>`
          )
        }

        // 檢查是否過期
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
          return reply.type('text/html').send(renderExpiredPage(data.expires_at))
        }

        // 返回廣告頁面
        return reply.type('text/html').send(renderAdPage(shortCode, data.original_url))
      } catch (err) {
        fastify.log.error(err)
        return reply.code(500).send({ error: 'Internal server error' })
      }
    }
  )

  // 記錄廣告曝光
  fastify.post<{ Params: { shortCode: string } }>(
    '/api/ad/:shortCode/view',
    async (request, reply) => {
      const { shortCode } = request.params

      try {
        // 查詢短網址
        const { data, error } = await supabase
          .from('urls')
          .select('id')
          .eq('short_code', shortCode)
          .single()

        if (error || !data) {
          return reply.code(404).send({ error: 'URL not found' })
        }

        // 記錄廣告曝光
        await supabase.from('url_clicks').insert({
          url_id: data.id,
          user_agent: request.headers['user-agent'] || null,
          event_type: 'ad_view'
        })

        return reply.send({ success: true })
      } catch (err) {
        fastify.log.error(err)
        return reply.code(500).send({ error: 'Failed to record view' })
      }
    }
  )

  // 記錄廣告點擊並返回目標網址
  fastify.post<{ Params: { shortCode: string } }>(
    '/api/ad/:shortCode/click',
    async (request, reply) => {
      const { shortCode } = request.params

      try {
        // 查詢短網址
        const { data, error } = await supabase
          .from('urls')
          .select('id, original_url')
          .eq('short_code', shortCode)
          .single()

        if (error || !data) {
          return reply.code(404).send({ error: 'URL not found' })
        }

        // 記錄廣告點擊
        await supabase.from('url_clicks').insert({
          url_id: data.id,
          user_agent: request.headers['user-agent'] || null,
          event_type: 'ad_click'
        })

        return reply.send({
          success: true,
          original_url: data.original_url
        })
      } catch (err) {
        fastify.log.error(err)
        return reply.code(500).send({ error: 'Failed to record click' })
      }
    }
  )

  // 獲取 URL 統計資料（需要登入，RLS 確保只能看自己的）
  fastify.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/api/urls/:id/stats',
    async (request, reply) => {
      // 驗證使用者登入
      const userClient = getUserClientFromRequest(request)
      if (!userClient) {
        return sendUnauthorized(reply)
      }

      const { id } = request.params
      const days = parseInt(request.query.days || '30')

      try {
        // 先確認該 URL 屬於該使用者（使用 user client，RLS 會過濾）
        const { data: urlData, error: urlError } = await userClient
          .from('urls')
          .select('id')
          .eq('id', id)
          .single()

        if (urlError || !urlData) {
          return reply.code(404).send({ error: 'URL not found' })
        }

        // 取得點擊統計（使用 service client 查詢 url_clicks）
        const { data: clicksData, error: clicksError } = await supabase
          .from('url_clicks')
          .select('event_type, clicked_at')
          .eq('url_id', id)

        if (clicksError) {
          fastify.log.error(clicksError)
          return reply.code(500).send({ error: 'Failed to fetch stats' })
        }

        // 計算總體統計
        const clicks = clicksData || []
        const linkClicks = clicks.filter(c => c.event_type === 'link_click' || c.event_type === 'ad_click').length
        const qrScans = clicks.filter(c => c.event_type === 'qr_scan').length
        const adViews = clicks.filter(c => c.event_type === 'ad_view').length
        const adClicks = clicks.filter(c => c.event_type === 'ad_click').length
        const lastClickedAt = clicks.length > 0
          ? clicks.sort((a, b) => new Date(b.clicked_at).getTime() - new Date(a.clicked_at).getTime())[0].clicked_at
          : null

        // 計算每日統計
        const dailyMap = new Map<string, { total: number; link: number; qr: number; ad_view: number; ad_click: number }>()
        for (const click of clicks) {
          const date = new Date(click.clicked_at).toISOString().split('T')[0]
          const existing = dailyMap.get(date) || { total: 0, link: 0, qr: 0, ad_view: 0, ad_click: 0 }
          existing.total++
          if (click.event_type === 'link_click') existing.link++
          if (click.event_type === 'qr_scan') existing.qr++
          if (click.event_type === 'ad_view') existing.ad_view++
          if (click.event_type === 'ad_click') existing.ad_click++
          dailyMap.set(date, existing)
        }

        const dailyStats = Array.from(dailyMap.entries())
          .map(([date, stats]) => ({
            date,
            total_clicks: stats.total,
            link_clicks: stats.link,
            qr_scans: stats.qr,
            ad_views: stats.ad_view,
            ad_clicks: stats.ad_click
          }))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, days)

        return reply.send({
          total: {
            total_clicks: clicks.length,
            link_clicks: linkClicks,
            qr_scans: qrScans,
            ad_views: adViews,
            ad_clicks: adClicks,
            last_clicked_at: lastClickedAt
          },
          daily: dailyStats
        })
      } catch (error) {
        fastify.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch stats' })
      }
    }
  )

  // 取得統計摘要（需要登入，只顯示該使用者的統計）
  fastify.get('/api/urls/stats/summary', async (request, reply) => {
    // 驗證使用者登入
    const userClient = getUserClientFromRequest(request)
    if (!userClient) {
      return sendUnauthorized(reply)
    }

    try {
      // 使用 user client 查詢，RLS 會自動過濾只顯示該使用者的 URLs
      const { data: urlsData, error } = await userClient
        .from('urls')
        .select('id, is_active')

      if (error) {
        fastify.log.error({ err: error }, 'Failed to fetch stats summary')
        return reply.code(500).send({ error: 'Failed to fetch statistics' })
      }

      const totalLinks = urlsData?.length || 0
      const activeLinks = urlsData?.filter(u => u.is_active).length || 0

      // 取得該使用者所有 URLs 的點擊數
      const urlIds = urlsData?.map(u => u.id) || []
      let totalClicks = 0

      if (urlIds.length > 0) {
        const { count } = await supabase
          .from('url_clicks')
          .select('*', { count: 'exact', head: true })
          .in('url_id', urlIds)

        totalClicks = count || 0
      }

      return reply.send({
        totalLinks,
        activeLinks,
        totalClicks
      })
    } catch (error) {
      fastify.log.error({ err: error }, 'Error calculating stats summary')
      return reply.code(500).send({ error: 'Internal server error' })
    }
  })

  // 注意：已改用一般 View，統計數據即時更新，不需要手動刷新端點

  // 取得每日統計（用於 analytics 頁面圖表）
  fastify.get<{ Querystring: { days?: string } }>(
    '/api/stats/daily',
    async (request, reply) => {
      // 驗證使用者登入
      const userClient = getUserClientFromRequest(request)
      if (!userClient) {
        return sendUnauthorized(reply)
      }

      const days = parseInt(request.query.days || '30')

      try {
        // 取得該使用者的所有 URL IDs
        const { data: urlsData, error: urlsError } = await userClient
          .from('urls')
          .select('id')

        if (urlsError) {
          fastify.log.error(urlsError)
          return reply.code(500).send({ error: 'Failed to fetch URLs' })
        }

        const urlIds = urlsData?.map(u => u.id) || []

        if (urlIds.length === 0) {
          // 沒有 URLs，返回空的每日統計
          return reply.send([])
        }

        // 計算日期範圍
        const endDate = new Date()
        const startDate = new Date()
        startDate.setDate(startDate.getDate() - days)

        // 取得點擊資料
        const { data: clicksData, error: clicksError } = await supabase
          .from('url_clicks')
          .select('event_type, clicked_at')
          .in('url_id', urlIds)
          .gte('clicked_at', startDate.toISOString())
          .lte('clicked_at', endDate.toISOString())

        if (clicksError) {
          fastify.log.error(clicksError)
          return reply.code(500).send({ error: 'Failed to fetch clicks' })
        }

        // 按日期分組統計
        const dailyMap = new Map<string, { link_clicks: number; qr_scans: number; ad_views: number; ad_clicks: number }>()

        // 初始化所有日期
        for (let i = 0; i < days; i++) {
          const date = new Date(startDate)
          date.setDate(date.getDate() + i)
          const dateStr = date.toISOString().split('T')[0]
          dailyMap.set(dateStr, { link_clicks: 0, qr_scans: 0, ad_views: 0, ad_clicks: 0 })
        }

        // 計算每日統計
        for (const click of clicksData || []) {
          const dateStr = new Date(click.clicked_at).toISOString().split('T')[0]
          const existing = dailyMap.get(dateStr) || { link_clicks: 0, qr_scans: 0, ad_views: 0, ad_clicks: 0 }
          if (click.event_type === 'qr_scan') {
            existing.qr_scans++
          } else if (click.event_type === 'ad_view') {
            existing.ad_views++
          } else if (click.event_type === 'ad_click') {
            existing.ad_clicks++
          } else {
            existing.link_clicks++
          }
          dailyMap.set(dateStr, existing)
        }

        // 轉換為陣列並排序
        const dailyStats = Array.from(dailyMap.entries())
          .map(([date, stats]) => ({
            date,
            link_clicks: stats.link_clicks,
            qr_scans: stats.qr_scans,
            ad_views: stats.ad_views,
            ad_clicks: stats.ad_clicks
          }))
          .sort((a, b) => a.date.localeCompare(b.date))

        return reply.send(dailyStats)
      } catch (error) {
        fastify.log.error(error)
        return reply.code(500).send({ error: 'Failed to fetch daily stats' })
      }
    }
  )

  // ========== 使用者相關 API ==========

  // 登入取得 JWT Token（嚴格速率限制：5次/分鐘，防止暴力破解）
  fastify.post<{
    Body: {
      email: string
      password: string
    }
  }>('/api/auth/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body

    if (!email || !password) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'email 和 password 為必填'
      })
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: error.message
        })
      }

      return reply.send({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_in: data.session?.expires_in,
        token_type: 'Bearer',
        user: {
          id: data.user?.id,
          email: data.user?.email
        }
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Login failed' })
    }
  })

  // 註冊新使用者（嚴格速率限制：3次/分鐘，防止批量註冊）
  fastify.post<{
    Body: {
      email: string
      password: string
      display_name?: string
    }
  }>('/api/auth/register', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const { email, password, display_name } = request.body

    if (!email || !password) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'email 和 password 為必填'
      })
    }

    // 密碼長度驗證
    if (password.length < 6) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: '密碼至少需要 6 個字元'
      })
    }

    try {
      // 使用 admin API 建立已確認的用戶
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,  // 自動確認，不需要郵件驗證
        user_metadata: {
          display_name: display_name || email.split('@')[0]
        }
      })

      if (error) {
        // 處理常見錯誤
        if (error.message.includes('already been registered')) {
          return reply.code(409).send({
            error: 'Conflict',
            message: '此電子郵件已被註冊'
          })
        }
        return reply.code(400).send({
          error: 'Bad Request',
          message: error.message
        })
      }

      return reply.code(201).send({
        message: '註冊成功',
        user: {
          id: data.user?.id,
          email: data.user?.email,
          display_name: data.user?.user_metadata?.display_name
        }
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Registration failed' })
    }
  })

  // 取得當前使用者資訊
  fastify.get('/api/auth/me', async (request, reply) => {
    const token = extractToken(request.headers.authorization)
    if (!token) {
      return sendUnauthorized(reply)
    }

    try {
      // 驗證 Token 並取得使用者資訊
      const { data: { user }, error } = await supabase.auth.getUser(token)

      if (error || !user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Token 無效或已過期'
        })
      }

      // 取得使用者 profile
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      return reply.send({
        id: user.id,
        email: user.email,
        display_name: profile?.display_name || user.email,
        avatar_url: profile?.avatar_url,
        metadata: profile?.metadata || {},
        created_at: user.created_at
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to get user info' })
    }
  })

  // 更新使用者 profile
  fastify.put<{
    Body: {
      display_name?: string
      avatar_url?: string
      metadata?: object
    }
  }>('/api/auth/profile', async (request, reply) => {
    const token = extractToken(request.headers.authorization)
    if (!token) {
      return sendUnauthorized(reply)
    }

    try {
      // 驗證 Token 並取得使用者資訊
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)

      if (authError || !user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Token 無效或已過期'
        })
      }

      const { display_name, avatar_url, metadata } = request.body
      const updates: any = {}

      if (display_name !== undefined) updates.display_name = display_name
      if (avatar_url !== undefined) updates.avatar_url = avatar_url
      if (metadata !== undefined) updates.metadata = metadata

      // 更新 user_profiles
      const { data: profile, error: updateError } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', user.id)
        .select()
        .single()

      if (updateError) {
        fastify.log.error(updateError)
        return reply.code(500).send({ error: 'Failed to update profile' })
      }

      return reply.send({
        id: user.id,
        email: user.email,
        display_name: profile?.display_name,
        avatar_url: profile?.avatar_url,
        metadata: profile?.metadata || {},
        updated_at: profile?.updated_at
      })
    } catch (error) {
      fastify.log.error(error)
      return reply.code(500).send({ error: 'Failed to update profile' })
    }
  })

  // ========== 內部追蹤 API（供 Nginx post_action 使用） ==========

  /**
   * 內部點擊追蹤 API
   * Nginx 會在返回快取響應後，異步調用此 API 記錄點擊
   *
   * 路徑格式：/api/internal/track/s/:shortCode
   */
  fastify.get<{
    Params: { shortCode: string }
    Querystring: { qr?: string }
  }>(
    '/api/internal/track/s/:shortCode',
    async (request, reply) => {
      const { shortCode } = request.params
      const { qr } = request.query
      const isQrScan = qr === '1' || qr === 'true'

      try {
        // 從 Redis 快取或資料庫取得 URL ID
        const cacheKey = CACHE_KEYS.URL(shortCode)
        let urlId: string | null = null

        // 先嘗試從 Redis 取得
        const cached = await redis.get(cacheKey)
        if (cached) {
          const cachedData = JSON.parse(cached)
          urlId = cachedData.id
        } else {
          // 從資料庫查詢
          const { data } = await supabase
            .from('urls')
            .select('id')
            .eq('short_code', shortCode)
            .eq('is_active', true)
            .single()

          if (data) {
            urlId = data.id
          }
        }

        if (!urlId) {
          // 找不到 URL，靜默返回（不影響用戶體驗）
          return reply.code(204).send()
        }

        // 記錄點擊
        await supabase.from('url_clicks').insert({
          url_id: urlId,
          user_agent: request.headers['user-agent'] || null,
          // 從 Nginx 傳遞的真實 IP
          ip_address: request.headers['x-real-ip'] as string || request.ip,
          event_type: isQrScan ? 'qr_scan' : 'link_click'
        })

        fastify.log.info({ shortCode, isQrScan }, 'Click tracked via Nginx post_action')

        // 返回 204 No Content（Nginx 不需要響應內容）
        return reply.code(204).send()
      } catch (error) {
        // 記錄錯誤但不影響用戶體驗
        fastify.log.error({ err: error, shortCode }, 'Failed to track click via post_action')
        return reply.code(204).send()
      }
    }
  )

  // ========== 美化路由（無 .html 擴展名） ==========

  // /links → serve links.html
  fastify.get('/links', async (request, reply) => {
    return reply.sendFile('links.html')
  })

  // /edit/:id → serve edit.html with id parameter
  fastify.get<{ Params: { id: string } }>('/edit/:id', async (request, reply) => {
    // 將 ID 放入查詢參數，讓前端 JS 可以讀取
    return reply.redirect(`/edit.html?id=${request.params.id}`, 302)
  })

  // /analytics → serve analytics.html
  fastify.get('/analytics', async (request, reply) => {
    return reply.sendFile('analytics.html')
  })

  // /docs → serve API documentation
  fastify.get('/docs', async (request, reply) => {
    return reply.sendFile('docs.html')
  })
}
