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

  // 取得所有短網址（分頁）— 透過後端 RPC 查詢
  async getUrls(page = 1, limit = 10) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')

    const res = await fetch(`${BASE_URL}/api/urls?page=${page}&limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store'
    })

    if (!res.ok) throw new Error('取得資料失敗')
    return res.json()
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

  // ======== 管道 API ========

  async getChannels(urlId) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')
    const res = await fetch(`${BASE_URL}/api/urls/${urlId}/channels`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) throw new Error('取得管道失敗')
    return res.json()
  },

  async createChannel(urlId, data) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')
    const res = await fetch(`${BASE_URL}/api/urls/${urlId}/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(data)
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || '建立管道失敗')
    return result
  },

  async updateChannel(urlId, channelId, data) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')
    const res = await fetch(`${BASE_URL}/api/urls/${urlId}/channels/${channelId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(data)
    })
    const result = await res.json()
    if (!res.ok) throw new Error(result.error || '更新管道失敗')
    return result
  },

  async deleteChannel(urlId, channelId) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')
    const res = await fetch(`${BASE_URL}/api/urls/${urlId}/channels/${channelId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (!res.ok) {
      const result = await res.json()
      throw new Error(result.error || '刪除管道失敗')
    }
    return res.json()
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

  // 取得統計數據 — 透過後端 RPC 查詢
  async getUrlStats(id, days = 30) {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')

    const res = await fetch(`${BASE_URL}/api/urls/${id}/stats?days=${days}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '取得統計失敗')
    }
    return res.json()
  },

  // 取得統計摘要 — 透過後端 RPC 查詢
  async getStatsSummary() {
    const token = await window.auth?.getAccessToken()
    if (!token) throw new Error('請先登入')

    const res = await fetch(`${BASE_URL}/api/urls/stats/summary`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (!res.ok) throw new Error('取得統計失敗')
    return res.json()
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

  // 格式化相對時間
  formatRelativeTime(dateString) {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    const diffWeek = Math.floor(diffDay / 7)
    const diffMonth = Math.floor(diffDay / 30)
    const diffYear = Math.floor(diffDay / 365)

    if (diffSec < 60) return '剛剛'
    if (diffMin < 60) return `${diffMin} 分鐘前`
    if (diffHour < 24) return `${diffHour} 小時前`
    if (diffDay < 7) return `${diffDay} 天前`
    if (diffWeek < 4) return `${diffWeek} 週前`
    if (diffMonth < 12) return `${diffMonth} 個月前`
    return `${diffYear} 年前`
  },

  // 下載 QR Code
  downloadQRCode(base64Data, filename = 'qrcode.png') {
    const link = document.createElement('a')
    link.href = base64Data
    link.download = filename
    link.click()
  }
}
