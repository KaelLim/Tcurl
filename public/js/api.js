// 資料操作模組 - 使用 Supabase JS 直接操作
// API endpoints (/api/*) 是給外部開發者使用的

const BASE_URL = window.location.origin

// 生成短代碼（使用密碼學安全的隨機數）
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const array = new Uint32Array(length)
  crypto.getRandomValues(array)
  return Array.from(array, x => chars[x % chars.length]).join('')
}

// 資料操作
const api = {
  // 取得 Supabase Client
  getClient() {
    if (!window.auth) {
      throw new Error('Auth module not loaded')
    }
    return window.auth.getClient()
  },

  // 建立短網址
  async createUrl(originalUrl, customShortCode = null) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    const user = await window.auth.getUser()
    if (!user) throw new Error('請先登入')

    // 生成或使用自訂短代碼
    let shortCode = customShortCode
    if (!shortCode) {
      // 檢查唯一性並生成
      let attempts = 0
      while (attempts < 10) {
        shortCode = generateShortCode(6)
        const { data: existing } = await client
          .from('urls')
          .select('short_code')
          .eq('short_code', shortCode)
          .single()

        if (!existing) break
        attempts++
      }
      if (attempts >= 10) {
        throw new Error('無法生成唯一的短代碼')
      }
    }

    // 插入資料
    const { data, error } = await client
      .from('urls')
      .insert({
        short_code: shortCode,
        original_url: originalUrl,
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Create URL error:', error)
      throw new Error(error.message || '建立短網址失敗')
    }

    return {
      ...data,
      short_url: `${BASE_URL}/s/${shortCode}`
    }
  },

  // 取得所有短網址（分頁）
  async getUrls(page = 1, limit = 10) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    const offset = (page - 1) * limit

    // 取得總數
    const { count, error: countError } = await client
      .from('urls')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)

    if (countError) throw new Error('取得資料失敗')

    // 取得分頁資料
    const { data: urlsData, error: urlsError } = await client
      .from('urls')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (urlsError) throw new Error('取得資料失敗')

    // 取得點擊統計
    const urlIds = urlsData?.map(u => u.id) || []
    let statsMap = new Map()

    if (urlIds.length > 0) {
      const { data: clicksData } = await client
        .from('url_clicks')
        .select('url_id, event_type, clicked_at')
        .in('url_id', urlIds)

      for (const urlId of urlIds) {
        const clicks = clicksData?.filter(c => c.url_id === urlId) || []
        const linkClicks = clicks.filter(c => c.event_type === 'link_click').length
        const qrScans = clicks.filter(c => c.event_type === 'qr_scan').length
        const adViews = clicks.filter(c => c.event_type === 'ad_view').length
        const adClicks = clicks.filter(c => c.event_type === 'ad_click').length
        // 總點擊數：排除 ad_view（曝光不算點擊）
        const totalClicks = linkClicks + qrScans + adClicks
        const lastClick = clicks.length > 0
          ? clicks.sort((a, b) => new Date(b.clicked_at) - new Date(a.clicked_at))[0].clicked_at
          : null

        statsMap.set(urlId, {
          total: totalClicks,
          link: linkClicks,
          qr: qrScans,
          ad_views: adViews,
          ad_clicks: adClicks,
          last: lastClick
        })
      }
    }

    // 合併資料
    const mergedData = urlsData?.map(url => {
      const stats = statsMap.get(url.id) || { total: 0, link: 0, qr: 0, ad_views: 0, ad_clicks: 0, last: null }
      return {
        ...url,
        clicks: stats.total,
        link_clicks: stats.link,
        qr_scans: stats.qr,
        ad_views: stats.ad_views,
        ad_clicks: stats.ad_clicks,
        last_clicked_at: stats.last
      }
    })

    const totalPages = Math.ceil((count || 0) / limit)

    return {
      data: mergedData,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    }
  },

  // 取得單個短網址詳情
  async getUrl(id) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    const { data, error } = await client
      .from('urls')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      throw new Error('找不到此短網址')
    }

    return data
  },

  // 更新短網址（透過後端 API 處理密碼 hash）
  async updateUrl(id, updates) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')

    const response = await fetch(`${BASE_URL}/api/urls/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(updates)
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || '更新失敗')
    }

    return data
  },

  // 刪除短網址
  async deleteUrl(id) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    const { error } = await client
      .from('urls')
      .delete()
      .eq('id', id)

    if (error) {
      throw new Error(error.message || '刪除失敗')
    }

    return { success: true }
  },

  // 更新 QR Code 配置
  async updateQRCode(id, qrCodeOptions, qrCodeDataUrl = null) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    const updates = {
      qr_code_options: qrCodeOptions,
      qr_code_generated: true
    }

    // 如果有 PNG data URL，需要透過後端保存檔案
    if (qrCodeDataUrl) {
      const token = await window.auth.getAccessToken()
      const response = await fetch(`${BASE_URL}/api/urls/${id}/qr-code`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          qr_code_options: qrCodeOptions,
          qr_code_data_url: qrCodeDataUrl
        })
      })

      if (!response.ok) {
        throw new Error('儲存 QR Code 失敗')
      }

      return response.json()
    }

    // 只更新配置，不保存檔案
    const { data, error } = await client
      .from('urls')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      throw new Error(error.message || '更新 QR Code 失敗')
    }

    return data
  },

  // 取得統計數據
  async getUrlStats(id, days = 30) {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    // 確認 URL 存在且屬於該使用者
    const { data: urlData, error: urlError } = await client
      .from('urls')
      .select('id')
      .eq('id', id)
      .single()

    if (urlError || !urlData) {
      throw new Error('找不到此短網址')
    }

    // 取得點擊統計
    const { data: clicksData, error: clicksError } = await client
      .from('url_clicks')
      .select('event_type, clicked_at')
      .eq('url_id', id)

    if (clicksError) {
      throw new Error('取得統計失敗')
    }

    const clicks = clicksData || []
    const linkClicks = clicks.filter(c => c.event_type === 'link_click').length
    const qrScans = clicks.filter(c => c.event_type === 'qr_scan').length
    const lastClickedAt = clicks.length > 0
      ? clicks.sort((a, b) => new Date(b.clicked_at) - new Date(a.clicked_at))[0].clicked_at
      : null

    // 計算每日統計
    const dailyMap = new Map()
    for (const click of clicks) {
      const date = new Date(click.clicked_at).toISOString().split('T')[0]
      const existing = dailyMap.get(date) || { total: 0, link: 0, qr: 0 }
      existing.total++
      if (click.event_type === 'link_click') existing.link++
      if (click.event_type === 'qr_scan') existing.qr++
      dailyMap.set(date, existing)
    }

    const dailyStats = Array.from(dailyMap.entries())
      .map(([date, stats]) => ({
        date,
        total_clicks: stats.total,
        link_clicks: stats.link,
        qr_scans: stats.qr
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, days)

    return {
      total: {
        total_clicks: clicks.length,
        link_clicks: linkClicks,
        qr_scans: qrScans,
        last_clicked_at: lastClickedAt
      },
      daily: dailyStats
    }
  },

  // 取得統計摘要
  async getStatsSummary() {
    const client = this.getClient()
    if (!client) throw new Error('請先登入')

    // 取得使用者的 URLs
    const { data: urlsData, error } = await client
      .from('urls')
      .select('id, is_active')

    if (error) {
      throw new Error('取得統計失敗')
    }

    const totalLinks = urlsData?.length || 0
    const activeLinks = urlsData?.filter(u => u.is_active).length || 0

    // 取得總點擊數
    const urlIds = urlsData?.map(u => u.id) || []
    let totalClicks = 0

    if (urlIds.length > 0) {
      const { count } = await client
        .from('url_clicks')
        .select('*', { count: 'exact', head: true })
        .in('url_id', urlIds)

      totalClicks = count || 0
    }

    return {
      totalLinks,
      activeLinks,
      totalClicks
    }
  }
}

// 工具函數
const utils = {
  // 複製到剪貼簿
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (err) {
      console.error('Failed to copy:', err)
      return false
    }
  },

  // 顯示通知訊息
  showNotification(message, type = 'success') {
    const notification = document.createElement('div')
    notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg z-50 ${
      type === 'success' ? 'bg-green-500' : 'bg-red-500'
    } text-white`
    notification.textContent = message

    document.body.appendChild(notification)

    setTimeout(() => {
      notification.remove()
    }, 3000)
  },

  // 格式化日期（顯示日期 + 時間）
  formatDate(dateString) {
    const date = new Date(dateString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}/${month}/${day} ${hours}:${minutes}`
  },

  // 下載 QR Code
  downloadQRCode(base64Data, filename = 'qrcode.png') {
    const link = document.createElement('a')
    link.href = base64Data
    link.download = filename
    link.click()
  }
}
