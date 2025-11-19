// API 基礎配置
const API_BASE_URL = window.location.origin

// API 輔助函數
const api = {
  // 建立短網址
  async createUrl(originalUrl) {
    const response = await fetch(`${API_BASE_URL}/api/urls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ original_url: originalUrl })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to create short URL')
    }

    return response.json()
  },

  // 取得所有短網址
  async getUrls() {
    const response = await fetch(`${API_BASE_URL}/api/urls`)

    if (!response.ok) {
      throw new Error('Failed to fetch URLs')
    }

    return response.json()
  },

  // 取得單個短網址詳情
  async getUrl(id) {
    const response = await fetch(`${API_BASE_URL}/api/urls/${id}`)

    if (!response.ok) {
      throw new Error('Failed to fetch URL details')
    }

    return response.json()
  },

  // 更新短網址
  async updateUrl(id, data) {
    const response = await fetch(`${API_BASE_URL}/api/urls/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to update URL')
    }

    return response.json()
  },

  // 刪除（停用）短網址
  async deleteUrl(id) {
    const response = await fetch(`${API_BASE_URL}/api/urls/${id}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      throw new Error('Failed to delete URL')
    }

    return response.json()
  },

  // 取得 QR Code (Base64)
  async getQRCode(shortCode) {
    const response = await fetch(`${API_BASE_URL}/api/qrcode/${shortCode}`)

    if (!response.ok) {
      throw new Error('Failed to fetch QR code')
    }

    return response.json()
  },

  // 取得統計數據（從即時 Views）
  async getUrlStats(id, days = 30) {
    const timestamp = Date.now()
    const response = await fetch(`${API_BASE_URL}/api/urls/${id}/stats?days=${days}&_=${timestamp}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to fetch URL statistics')
    }

    return response.json()
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
    // 簡單的通知實作（可以之後用更好的 UI 替換）
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

  // 格式化日期
  formatDate(dateString) {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffSecs = Math.floor(diffMs / 1000)
    const diffMins = Math.floor(diffSecs / 60)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 30) {
      return date.toLocaleDateString('zh-TW')
    } else if (diffDays > 0) {
      return `${diffDays} 天前`
    } else if (diffHours > 0) {
      return `${diffHours} 小時前`
    } else if (diffMins > 0) {
      return `${diffMins} 分鐘前`
    } else {
      return '剛剛'
    }
  },

  // 下載 QR Code
  downloadQRCode(base64Data, filename = 'qrcode.png') {
    const link = document.createElement('a')
    link.href = base64Data
    link.download = filename
    link.click()
  }
}
